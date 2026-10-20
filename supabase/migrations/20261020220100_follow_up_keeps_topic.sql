-- A topic stays active at the topic list while its follow-up waits to be asked
-- or skipped. Outside that, a question is active only during a response.

alter table public.sessions drop constraint sessions_response_has_question;
alter table public.sessions
  add constraint sessions_response_has_question
    check (
      (stage <> 'response' or active_question_id is not null)
      and (
        active_question_id is null
        or stage = 'response'
        or (stage = 'question_selection' and exchange = 'follow_up')
      )
    ),
  add constraint sessions_follow_up_has_question
    check (exchange = 'initial' or active_question_id is not null);
