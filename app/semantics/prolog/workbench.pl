% Glue between the page and the two editable files. Every wb_* predicate
% answers with a JSON string, and states are numbered so the page never has to
% hold a Prolog term.

:- use_module(library(json)).
:- dynamic state/2.

wb_load(Text, Json) :-
    reply(( load_spec(Text),
            initial(P),
            retractall(state(_, _)),
            intern(P, Id),
            findall(_{name: C, mark: M, types: T},
                    ( chan(C, M, Ts), format(string(T), "~w", [Ts]) ), Cs),
            Out = _{initial: Id, channels: Cs}
          ), Out, Json).

wb_state(Id, Json) :-
    reply(( state(Id, P), show(P, S), Out = _{id: Id, text: S} ), Out, Json).

% Every system transition out of state Id.
wb_transitions(Id, Json) :-
    reply(( state(Id, P),
            findall(T, transition(P, T), Ts),
            Out = _{transitions: Ts}
          ), Out, Json).

transition(P, _{label: LS, kind: K, rule: RS, target: Id, text: S}) :-
    sys_step(P, L, P2, D),
    show_label(L, LS),
    kind(L, K),
    format(string(RS), "~w", [D]),
    intern(P2, Id),
    show(P2, S).

kind(drop(_), drop) :- !.
kind(refuse(_), refuse) :- !.
kind(_, step).

% The process steps reachable from Id, breadth first, up to Max states.
% Dropped and refused events are left out: they never change the state.
wb_explore(Id, Max, Json) :-
    reply(( bfs([Id], [Id], Max, Seen),
            length(Seen, N),
            findall(S, ( member(I, Seen), summary(I, S) ), Ss),
            ( N >= Max -> More = true ; More = false ),
            Out = _{states: Ss, truncated: More}
          ), Out, Json).

bfs([], Seen, _, Seen).
bfs([I|Queue], Seen, Max, Out) :-
    state(I, P),
    findall(J, ( step(P, _, P2, _), intern(P2, J) ), Js0),
    sort(Js0, Js),
    exclude([J]>>memberchk(J, Seen), Js, New0),
    length(Seen, N), Room is max(0, Max - N),
    ( length(New0, K), K > Room -> length(New, Room), append(New, _, New0) ; New = New0 ),
    append(Seen, New, Seen2),
    append(Queue, New, Queue2),
    bfs(Queue2, Seen2, Max, Out).

summary(I, _{id: I, text: S, steps: N, status: St}) :-
    state(I, P), show(P, S),
    findall(x, step(P, _, _, _), Xs), length(Xs, N),
    (   P == omega -> St = terminated
    ;   N =:= 0 -> St = deadlock
    ;   St = live
    ).

intern(P, Id) :- state(Id, Q), Q == P, !.
intern(P, Id) :-
    aggregate_all(count, state(_, _), Id),
    assertz(state(Id, P)).

% Run any goal, showing up to Max solutions and whatever it printed.
wb_query(Text, Max, Json) :-
    reply(( term_string(Goal, Text, [variable_names(Vs)]),
            with_output_to(string(O), findall(Vs, limit(Max, Goal), Sols)),
            maplist(bindings, Sols, Bs),
            Out = _{solutions: Bs, output: O}
          ), Out, Json).

bindings(Vs, Bs) :-
    findall(S, ( member(N=V, Vs), \+ sub_atom(N, 0, _, _, '_'),
                 format(string(S), "~w = ~q", [N, V]) ), Bs).

reply(Goal, Out, Json) :-
    catch(( call(Goal) -> R = _{ok: true, value: Out} ; R = _{ok: false, error: "failed"} ),
          E,
          ( error_text(E, M), R = _{ok: false, error: M} )),
    with_output_to(string(Json), json_write_dict(current_output, R, [width(0)])).

error_text(spec_error(M), M) :- !.
error_text(E, M) :-
    catch(message_to_codes(E, Cs), _, fail), !,
    string_codes(M, Cs).
error_text(E, M) :- format(string(M), "~q", [E]).

message_to_codes(E, Cs) :-
    phrase('$messages':translate_message(E), Lines),
    with_output_to(codes(Cs), print_message_lines(current_output, '', Lines)).
