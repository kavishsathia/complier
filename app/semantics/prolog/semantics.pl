% Operational semantics.
%
% step(P, L, P2, D) reads P --L--> P2, and D names the rules that derived it.
% Labels: tau, tick (the ✓ event), and ev(Channel, Values) for a ∈ Σ.
% Processes are the terms parser.pl produces:
%   stop, skip, omega, pre(Msg, P), ext(P, Q), int(P, Q), guard(B, P),
%   seq(P, Q), par(X, P, Q) with X a list of channel names, call(N, Args).
% The spec's definitions and channels are the facts def(N, Params, Body) and
% chan(C, Mark, Types), with Mark one of world (~), agent (^) or internal.

% STOP, Ω and a false guard have no rules.

% [IO-Skip]
step(skip, tick, omega, 'IO-Skip').

% [IO-Prefix]
step(pre(M, P), A, P2, 'IO-Prefix') :-
    comms(M, A, Sigma),
    subst(P, Sigma, P2).

% [IO-ExtL] [IO-ExtR]: a ∈ Σ✓ resolves the choice.
step(ext(P, _), A, P2, 'IO-ExtL'(D)) :-
    step(P, A, P2, D), A \== tau.
step(ext(_, Q), A, Q2, 'IO-ExtR'(D)) :-
    step(Q, A, Q2, D), A \== tau.

% [IO-ExtTauL] [IO-ExtTauR]: τ does not.
step(ext(P, Q), tau, ext(P2, Q), 'IO-ExtTauL'(D)) :-
    step(P, tau, P2, D).
step(ext(P, Q), tau, ext(P, Q2), 'IO-ExtTauR'(D)) :-
    step(Q, tau, Q2, D).

% [IO-IntL] [IO-IntR]
step(int(P, _), tau, P, 'IO-IntL').
step(int(_, Q), tau, Q, 'IO-IntR').

% [IO-Guard-True]
step(guard(B, P), X, P2, 'IO-Guard-True'(D)) :-
    eval(B, true),
    step(P, X, P2, D).

% [IO-Seq] [IO-SeqTerm]
step(seq(P, Q), X, seq(P2, Q), 'IO-Seq'(D)) :-
    step(P, X, P2, D), X \== tick.
step(seq(P, Q), tau, Q, 'IO-SeqTerm'(D)) :-
    step(P, tick, _, D).

% [IO-ParL] [IO-ParR]: x ∉ X ∪ {✓}
step(par(X, P, Q), A, par(X, P2, Q), 'IO-ParL'(D)) :-
    step(P, A, P2, D), A \== tick, \+ synced(A, X).
step(par(X, P, Q), A, par(X, P, Q2), 'IO-ParR'(D)) :-
    step(Q, A, Q2, D), A \== tick, \+ synced(A, X).

% [IO-Sync]
step(par(X, P, Q), A, par(X, P2, Q2), 'IO-Sync'(D1, D2)) :-
    step(P, A, P2, D1), synced(A, X),
    step(Q, A, Q2, D2).

% [IO-ParTermL] [IO-ParTermR] [IO-ParTerm]
step(par(X, P, Q), tau, par(X, omega, Q), 'IO-ParTermL'(D)) :-
    step(P, tick, _, D).
step(par(X, P, Q), tau, par(X, P, omega), 'IO-ParTermR'(D)) :-
    step(Q, tick, _, D).
step(par(_, omega, omega), tick, omega, 'IO-ParTerm').

% [IO-Call]: ⟦eᵢ⟧ ∈ ⟦τᵢ⟧ for all i
step(call(N, Es), tau, P2, 'IO-Call') :-
    def(N, Params, P),
    maplist(eval, Es, Vs),
    maplist(bind_param, Params, Vs, Sigma),
    subst(P, Sigma, P2).

bind_param(X:T, V, X-V) :- has_type(V, T).

% The channel set X synchronises every event on its channels.
synced(ev(C, _), X) :- memberchk(C, X).


% System layer: S is a system state, here the main process term.

% offered(P) = { a ∈ Σ | ∃P'. P --a--> P' }
offered(P, As) :-
    findall(A, (step(P, A, _, _), A = ev(_, _)), L),
    sort(L, As).

% Every step of the process is a step of the system.
sys_step(S, L, S2, D) :- step(S, L, S2, D).

% [IO-Drop]: a ∈ Σ~, a ∉ offered(S)
sys_step(S, drop(A), S, 'IO-Drop') :-
    offered(S, Off),
    event(world, A), \+ memberchk(A, Off).

% [IO-Refuse]: a ∈ Σ^, a ∉ offered(S)
sys_step(S, refuse(A), S, 'IO-Refuse') :-
    offered(S, Off),
    event(agent, A), \+ memberchk(A, Off).

% Σ~ and Σ^: every value tuple on a channel with that mark.
event(Mark, ev(C, Vs)) :-
    chan(C, Mark, Ts),
    maplist(has_type, Vs, Ts).


% comms(m): the events a message can perform, each with the substitution σ
% binding its inputs. c?x ranges over the field's type, c!e and c.e send ⟦e⟧,
% and a value outside the field's type is no event at all.
comms(msg(C, Fs), ev(C, Vs), Sigma) :-
    chan(C, _, Ts),
    fields(Fs, Ts, Vs, Sigma).

fields([], [], [], []).
fields([in(X)|Fs], [T|Ts], [V|Vs], [X-V|Sigma]) :-
    has_type(V, T),
    fields(Fs, Ts, Vs, Sigma).
fields([out(E)|Fs], [T|Ts], [V|Vs], Sigma) :-
    eval(E, V), has_type(V, T),
    fields(Fs, Ts, Vs, Sigma).

% ⟦τ⟧
has_type(V, range(Lo, Hi)) :- between(Lo, Hi, V).
has_type(V, bool) :- member(V, [true, false]).

% ⟦e⟧ for closed expressions. Values are integers, true and false.
eval(V, V) :- integer(V), !.
eval(true, true) :- !.
eval(false, false) :- !.
eval(id(X), _) :- !,
    throw(error(free_variable(X), _)).
eval(not(E), V) :- !,
    eval(E, B), ( B == true -> V = false ; V = true ).
eval(and(A, B), V) :- !,
    eval(A, X), ( X == true -> eval(B, V) ; V = false ).
eval(or(A, B), V) :- !,
    eval(A, X), ( X == true -> V = true ; eval(B, V) ).
eval(neg(E), V) :- !,
    eval(E, X), V is -X.
eval(bin(Op, A, B), V) :-
    eval(A, X), eval(B, Y),
    op_value(Op, X, Y, V).

op_value(+, X, Y, V) :- V is X + Y.
op_value(-, X, Y, V) :- V is X - Y.
op_value(*, X, Y, V) :- V is X * Y.
op_value(==, X, Y, V) :- ( X == Y -> V = true ; V = false ).
op_value('!=', X, Y, V) :- ( X \== Y -> V = true ; V = false ).
op_value(<, X, Y, V) :- ( X < Y -> V = true ; V = false ).
op_value(<=, X, Y, V) :- ( X =< Y -> V = true ; V = false ).
op_value(>, X, Y, V) :- ( X > Y -> V = true ; V = false ).
op_value(>=, X, Y, V) :- ( X >= Y -> V = true ; V = false ).


% Pσ: replace free variables by values. An input c?x rebinds x for the
% rest of the prefix, so σ stops at it.
subst(stop, _, stop).
subst(skip, _, skip).
subst(omega, _, omega).
subst(pre(msg(C, Fs), P), S, pre(msg(C, Fs2), P2)) :-
    maplist(subst_field(S), Fs, Fs2),
    findall(X-V, (member(X-V, S), \+ memberchk(in(X), Fs)), Inner),
    subst(P, Inner, P2).
subst(ext(P, Q), S, ext(P2, Q2)) :- subst(P, S, P2), subst(Q, S, Q2).
subst(int(P, Q), S, int(P2, Q2)) :- subst(P, S, P2), subst(Q, S, Q2).
subst(seq(P, Q), S, seq(P2, Q2)) :- subst(P, S, P2), subst(Q, S, Q2).
subst(par(X, P, Q), S, par(X, P2, Q2)) :- subst(P, S, P2), subst(Q, S, Q2).
subst(guard(B, P), S, guard(B2, P2)) :- subst_expr(B, S, B2), subst(P, S, P2).
subst(call(N, Es), S, call(N, Es2)) :- maplist(subst_expr_(S), Es, Es2).

subst_field(_, in(X), in(X)).
subst_field(S, out(E), out(E2)) :- subst_expr(E, S, E2).

subst_expr_(S, E, E2) :- subst_expr(E, S, E2).

subst_expr(id(X), S, V) :- memberchk(X-V, S), !.
subst_expr(E, S, E2) :-
    compound(E), E \= id(_), !,
    E =.. [F|As],
    maplist(subst_expr_(S), As, As2),
    E2 =.. [F|As2].
subst_expr(E, _, E).
