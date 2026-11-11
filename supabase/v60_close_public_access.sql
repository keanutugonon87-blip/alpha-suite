-- v60 · Close the new functions to logged-out visitors.
-- Each of these already refuses people without the right role. This also stops someone who is not signed in from calling them at all.
-- The public pages (notices, receipts, standing, treasury, officers) are not touched. Safe to run twice.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'v2_class_ask','v2_class_ask_decide','v2_class_report_build','v2_class_report_review','v2_class_report_submit','v2_coa_conflicts',
             'v2_council_action','v2_council_attend','v2_council_close','v2_council_delete','v2_council_save','v2_council_share',
             'v2_deputy_revoke','v2_deputy_set','v2_deputy_status','v2_directive_act','v2_directive_decide','v2_directive_issue','v2_directive_issue_many',
             'v2_funds_overview','v2_incident_file','v2_incident_president','v2_incident_review','v2_inspection_close','v2_inspection_open',
             'v2_marshal_answer','v2_marshal_ask','v2_marshal_block_set','v2_marshal_overview','v2_memo_ack','v2_memo_send','v2_memo_status',
             'v2_president_overview','v2_question_answer','v2_question_ask','v2_receipt_overview','v2_sails_monthly','v2_scorecard','v2_schema_marks',
             'v2_template_delete','v2_template_save','v2_template_send_now','v2_unit_add_section')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
