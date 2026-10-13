% Parser: spec text -> the terms semantics.pl steps.
%
%   channel ~page_deleted : {0..2}
%   channel ^draft, ^recreate : {0..2}
%   COUNT(n : {0..3}) = n < 3 & up -> COUNT(n + 1) [] n > 0 & down -> COUNT(n - 1)
%
% Process names start with an uppercase letter; channels and variables with a
% lowercase one. A channel used without a declaration carries no data and is
% internal unless a prefix marks it (~a -> P). ASCII and Unicode both work:
% -> →, [] □, |~| ⊓. Comments run from -- to the end of the line.
%
% Binding, loosest first: [| {c, ..} |] and |||, then |~|, then [], then ;,
% then b & P, then c?x!e -> P. Inside !e and .e, write compound expressions in
% parentheses: c!(x + 1).

:- dynamic def/3, chan/3, implicit/1.

% load_spec(+Text): parse Text and replace the def/3 and chan/3 facts.
load_spec(Text) :-
    string_codes(Text, Codes),
    phrase(tokens(1, Ts0), Codes),
    number_tokens(Ts0, 1, Ts),
    nb_setval(far, 0),
    (   phrase(spec(Items), Ts)
    ->  true
    ;   nb_getval(far, I), nth1(I, Ts, t(Tok, Line, _)),
        show_token(Tok, S),
        spec_error(Line, "unexpected ~s", [S])
    ),
    retractall(def(_, _, _)),
    retractall(chan(_, _, _)),
    retractall(implicit(_)),
    declare(Items),
    check_defs.

spec_error(Line, Fmt, Args) :-
    format(string(M), Fmt, Args),
    format(string(S), "line ~w: ~s", [Line, M]),
    throw(spec_error(S)).


% Tokens: t(Token, Line, Index), ending with t(eof, Line, N).

tokens(L, Ts) --> "\n", !, { L1 is L + 1 }, tokens(L1, Ts).
tokens(L, Ts) --> [C], { code_type(C, space) }, !, tokens(L, Ts).
tokens(L, Ts) --> "--", !, rest_of_line, tokens(L, Ts).
tokens(L, [T-L|Ts]) --> token(T), !, tokens(L, Ts).
tokens(L, _) --> [C], !, { spec_error(L, "unexpected character '~c'", [C]) }.
tokens(L, [eof-L]) --> [].

rest_of_line --> [C], { C \== 0'\n }, !, rest_of_line.
rest_of_line --> [].

token(num(N)) --> digit(D), digits(Ds), { number_codes(N, [D|Ds]) }.
token(id(A)) --> [C], { code_type(C, csymf) }, idchars(Cs), { atom_codes(A, [C|Cs]) }.
token(P) --> punct(P).

digit(D) --> [D], { code_type(D, digit) }.
digits([D|Ds]) --> digit(D), !, digits(Ds).
digits([]) --> [].
idchars([C|Cs]) --> [C], { code_type(C, csym) }, !, idchars(Cs).
idchars([]) --> [].

punct('|||') --> "|||".
punct('|~|') --> "|~|".
punct('|~|') --> "⊓".
punct('[|') --> "[|".
punct('|]') --> "|]".
punct('[]') --> "[]".
punct('[]') --> "□".
punct('->') --> "->".
punct('->') --> "→".
punct('..') --> "..".
punct(Op) --> [C1, C2], { member(Op, ['==', '!=', '<=', '>=']), atom_codes(Op, [C1, C2]) }.
punct(P) --> [C], { memberchk(C, `<>+-*(){},:=&;?!.~^`), atom_codes(P, [C]) }.

number_tokens([], _, []).
number_tokens([T-L|Ts], I, [t(T, L, I)|Rs]) :- I1 is I + 1, number_tokens(Ts, I1, Rs).

% tok(T) consumes one token, remembering the furthest one tried so a failed
% parse can point at it.
tok(T, [t(T0, _, I)|Rest], Rest) :-
    nb_getval(far, F), ( I > F -> nb_setval(far, I) ; true ),
    T = T0.

show_token(eof, "end of input") :- !.
show_token(num(N), S) :- !, format(string(S), "~w", [N]).
show_token(id(A), S) :- !, format(string(S), "'~w'", [A]).
show_token(P, S) :- format(string(S), "'~w'", [P]).


% Grammar.

spec([]) --> tok(eof), !.
spec([I|Is]) --> item(I), spec(Is).

item(chans(Ns, Ts)) -->
    tok(id(channel)), !,
    marked_names(Ns),
    ( tok(':') -> types(Ts) ; { Ts = [] } ).
item(def(N, Ps, P, Line)) -->
    line(Line), pname(N), params(Ps), tok('='), proc(P).

line(L, Ts, Ts) :- Ts = [t(_, L, _)|_].

marked_names([M-N|Ns]) --> mark(M), cname(N), ( tok(',') -> marked_names(Ns) ; { Ns = [] } ).

mark(world) --> tok('~'), !.
mark(agent) --> tok('^'), !.
mark(none) --> [].

types([T|Ts]) --> type(T), ( tok('.') -> types(Ts) ; { Ts = [] } ).

type(bool) --> tok(id('Bool')), !.
type(range(Lo, Hi)) --> tok('{'), int(Lo), tok('..'), int(Hi), tok('}').

int(N) --> tok('-'), !, tok(num(M)), { N is -M }.
int(N) --> tok(num(N)).

params(Ps) --> tok('('), !, param_list(Ps), tok(')').
params([]) --> [].
param_list([X:T|Ps]) --> vname(X), tok(':'), type(T), ( tok(',') -> param_list(Ps) ; { Ps = [] } ).

pname(N) --> tok(id(N)), { upper(N), \+ keyword(N) }.
cname(N) --> tok(id(N)), { \+ upper(N), \+ keyword(N) }.
vname(N) --> cname(N).

upper(A) :- atom_codes(A, [C|_]), code_type(C, upper).
keyword(K) :- memberchk(K, [channel, and, or, not, true, false, 'STOP', 'SKIP', 'Bool']).

proc(P) --> int_(L), par_rest(L, P).

par_rest(L, P) --> tok('[|'), !, tok('{'), chan_list(X), tok('}'), tok('|]'), int_(R), par_rest(par(X, L, R), P).
par_rest(L, P) --> tok('|||'), !, int_(R), par_rest(par([], L, R), P).
par_rest(P, P) --> [].

chan_list([C|Cs]) --> cname(C), ( tok(',') -> chan_list(Cs) ; { Cs = [] } ).
chan_list([]) --> [].

int_(P) --> ext_(L), int_rest(L, P).
int_rest(L, P) --> tok('|~|'), !, ext_(R), int_rest(int(L, R), P).
int_rest(P, P) --> [].

ext_(P) --> seq_(L), ext_rest(L, P).
ext_rest(L, P) --> tok('[]'), !, seq_(R), ext_rest(ext(L, R), P).
ext_rest(P, P) --> [].

seq_(P) --> guarded(L), seq_rest(L, P).
seq_rest(L, P) --> tok(';'), !, guarded(R), seq_rest(seq(L, R), P).
seq_rest(P, P) --> [].

guarded(guard(B, P)) --> expr(B), tok('&'), !, guarded(P).
guarded(P) --> prefix(P).

prefix(pre(mmsg(M, C, Fs), P)) --> mark(M), cname(C), fields(Fs), tok('->'), !, guarded(P).
prefix(P) --> atom_(P).

fields([in(X)|Fs]) --> tok('?'), !, vname(X), fields(Fs).
fields([out(E)|Fs]) --> tok('!'), !, primary(E), fields(Fs).
fields([out(E)|Fs]) --> tok('.'), !, primary(E), fields(Fs).
fields([]) --> [].

atom_(stop) --> tok(id('STOP')), !.
atom_(skip) --> tok(id('SKIP')), !.
atom_(call(N, Es)) --> pname(N), !, args(Es).
atom_(P) --> tok('('), proc(P), tok(')').

args(Es) --> tok('('), !, expr_list(Es), tok(')').
args([]) --> [].
expr_list([E|Es]) --> expr(E), ( tok(',') -> expr_list(Es) ; { Es = [] } ).

expr(E) --> and_(L), or_rest(L, E).
or_rest(L, E) --> tok(id(or)), !, and_(R), or_rest(or(L, R), E).
or_rest(E, E) --> [].

and_(E) --> not_(L), and_rest(L, E).
and_rest(L, E) --> tok(id(and)), !, not_(R), and_rest(and(L, R), E).
and_rest(E, E) --> [].

not_(not(E)) --> tok(id(not)), !, not_(E).
not_(E) --> sum_(L), ( cmp_op(Op) -> sum_(R), { E = bin(Op, L, R) } ; { E = L } ).

cmp_op(Op) --> tok(Op), { memberchk(Op, ['==', '!=', '<', '<=', '>', '>=']) }.

sum_(E) --> product(L), sum_rest(L, E).
sum_rest(L, E) --> tok(Op), { memberchk(Op, [+, -]) }, !, product(R), sum_rest(bin(Op, L, R), E).
sum_rest(E, E) --> [].

product(E) --> unary(L), product_rest(L, E).
product_rest(L, E) --> tok(*), !, unary(R), product_rest(bin(*, L, R), E).
product_rest(E, E) --> [].

unary(neg(E)) --> tok(-), !, unary(E).
unary(E) --> primary(E).

primary(N) --> tok(num(N)), !.
primary(true) --> tok(id(true)), !.
primary(false) --> tok(id(false)), !.
primary(id(X)) --> vname(X), !.
primary(E) --> tok('('), expr(E), tok(')').


% Declaring the parsed items as def/3 and chan/3 facts.

declare(Items) :-
    forall(member(chans(Ns, Ts), Items),
           forall(member(M-C, Ns), declare_chan(C, M, Ts))),
    findall(N-(Ps-P-L), member(def(N, Ps, P, L), Items), Defs),
    forall(member(N-(Ps-P0-L), Defs),
           (   def(N, _, _)
           ->  spec_error(L, "~w is defined twice", [N])
           ;   catch(normalise(P0, Ps, P), spec_error(M), spec_error(L, "~s", [M])),
               assertz(def(N, Ps, P))
           )).

declare_chan(C, _, _) :-
    chan(C, _, _), !,
    format(string(M), "channel ~w is declared twice", [C]),
    throw(spec_error(M)).
declare_chan(C, none, Ts) :- !, assertz(chan(C, internal, Ts)).
declare_chan(C, M, Ts) :- assertz(chan(C, M, Ts)).

% normalise(+Raw, +Params, -P): drop prefix marks into the channel table,
% declaring channels used without a declaration, and check variables are bound.
normalise(Raw, Ps, P) :-
    findall(X, member(X:_, Ps), Scope),
    norm(Raw, Scope, P).

norm(stop, _, stop).
norm(skip, _, skip).
norm(pre(mmsg(M, C, Fs), P0), Scope, pre(msg(C, Fs), P)) :-
    use_chan(C, M, Fs),
    findall(X, member(in(X), Fs), Bound),
    forall(member(out(E), Fs), bound_expr(E, Scope)),
    append(Bound, Scope, Inner),
    norm(P0, Inner, P).
norm(ext(A0, B0), S, ext(A, B)) :- norm(A0, S, A), norm(B0, S, B).
norm(int(A0, B0), S, int(A, B)) :- norm(A0, S, A), norm(B0, S, B).
norm(seq(A0, B0), S, seq(A, B)) :- norm(A0, S, A), norm(B0, S, B).
norm(par(X, A0, B0), S, par(X, A, B)) :-
    forall(member(C, X), use_chan(C, none, [])),
    norm(A0, S, A), norm(B0, S, B).
norm(guard(B, P0), S, guard(B, P)) :- bound_expr(B, S), norm(P0, S, P).
norm(call(N, Es), S, call(N, Es)) :- forall(member(E, Es), bound_expr(E, S)).

use_chan(C, M, Fs) :-
    length(Fs, Arity),
    (   chan(C, Declared, Ts)
    ->  length(Ts, N),
        (   Fs \== [], N \== Arity
        ->  err("~w carries ~w field(s), not ~w", [C, N, Arity])
        ;   M \== none, Declared == internal, implicit(C)
        ->  retract(chan(C, internal, Ts)), assertz(chan(C, M, Ts))
        ;   M \== none, M \== Declared
        ->  err("~w is marked ~w here but declared ~w", [C, M, Declared])
        ;   true
        )
    ;   Arity > 0
    ->  err("channel ~w carries data, so declare its type", [C])
    ;   declare_chan(C, M, []),
        assertz(implicit(C))
    ).

bound_expr(E, Scope) :-
    forall(sub_term(id(X), E),
           ( memberchk(X, Scope) -> true ; err("~w is not bound here", [X]) )).

err(Fmt, Args) :- format(string(M), Fmt, Args), throw(spec_error(M)).

% Every call names a defined process with the right number of arguments.
check_defs :-
    forall(( def(_, _, P), sub_term(call(N, Es), P) ),
           (   def(N, Ps, _)
           ->  length(Es, K), length(Ps, J),
               ( K == J -> true ; err("~w takes ~w argument(s), not ~w", [N, J, K]) )
           ;   err("process ~w is used but never defined", [N])
           )).

% The process a run starts from: MAIN, else the first definition.
initial(call(N, [])) :-
    (   def('MAIN', [], _) -> N = 'MAIN'
    ;   def(N, [], _) -> true
    ;   err("define MAIN, or a process without parameters", [])
    ).


% Printing terms back in the spec's syntax.

show(P, S) :- phrase(sp(P, 0), Cs), string_codes(S, Cs).

% Binding strength of each operator; a looser term inside a tighter context
% gets parentheses.
level(P, L) :- level_(P, L0) -> L = L0 ; L = 7.
level_(par(_, _, _), 1).
level_(int(_, _), 2).
level_(ext(_, _), 3).
level_(seq(_, _), 4).
level_(guard(_, _), 5).
level_(pre(_, _), 6).

sp(P, Ctx) --> { level(P, L) }, ( { L < Ctx } -> "(", sp_(P), ")" ; sp_(P) ).

sp_(stop) --> "STOP".
sp_(skip) --> "SKIP".
sp_(omega) --> "Ω".
sp_(call(N, [])) --> !, at(N).
sp_(call(N, Es)) --> at(N), "(", exprs(Es), ")".
sp_(pre(msg(C, Fs), P)) --> at(C), sfields(Fs), " -> ", sp(P, 5).
sp_(guard(B, P)) --> se(B), " & ", sp(P, 5).
sp_(seq(P, Q)) --> sp(P, 4), "; ", sp(Q, 5).
sp_(ext(P, Q)) --> sp(P, 3), " [] ", sp(Q, 4).
sp_(int(P, Q)) --> sp(P, 2), " |~| ", sp(Q, 3).
sp_(par([], P, Q)) --> !, sp(P, 1), " ||| ", sp(Q, 2).
sp_(par(X, P, Q)) --> sp(P, 1), " [| {", names(X), "} |] ", sp(Q, 2).

sfields([]) --> [].
sfields([in(X)|Fs]) --> "?", at(X), sfields(Fs).
sfields([out(E)|Fs]) --> "!", sprim(E), sfields(Fs).

sprim(E) --> { atomic(E) ; E = id(_) }, !, se(E).
sprim(E) --> "(", se(E), ")".

se(id(X)) --> !, at(X).
se(not(E)) --> !, "not ", sprim(E).
se(neg(E)) --> !, "-", sprim(E).
se(and(A, B)) --> !, sprim(A), " and ", sprim(B).
se(or(A, B)) --> !, sprim(A), " or ", sprim(B).
se(bin(Op, A, B)) --> !, sprim(A), " ", at(Op), " ", sprim(B).
se(V) --> at(V).

exprs([E]) --> !, se(E).
exprs([E|Es]) --> se(E), ", ", exprs(Es).

names([]) --> [].
names([N]) --> !, at(N).
names([N|Ns]) --> at(N), ", ", names(Ns).

at(A) --> { format(codes(Cs), "~w", [A]) }, Cs.

% Labels: τ, ✓, c.1.true, and the system's ↓a (dropped) and ×a (refused).
show_label(tau, "τ").
show_label(tick, "✓").
show_label(ev(C, Vs), S) :- atomic_list_concat([C|Vs], '.', A), atom_string(A, S).
show_label(drop(A), S) :- show_label(A, T), string_concat("↓", T, S).
show_label(refuse(A), S) :- show_label(A, T), string_concat("×", T, S).
