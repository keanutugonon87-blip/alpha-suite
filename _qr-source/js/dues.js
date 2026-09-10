// =====================================================================
// Dues configuration (admin/treasurer) + status computation.
// =====================================================================
import { supabase } from './supabase-client.js';

// --- Admin: recurring dues config -----------------------------------

export async function createDuesConfig({ termLabel, amount, frequency, startsOn, endsOn }) {
  const { data, error } = await supabase
    .from('dues_config')
    .insert({
      term_label: termLabel,
      amount,
      frequency,        // 'weekly' | 'monthly' | 'per_term'
      starts_on: startsOn,
      ends_on: endsOn || null,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listDuesConfigs() {
  const { data, error } = await supabase
    .from('dues_config')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setStudentOverride({ duesConfigId, studentId, overrideType, customAmount, reason }) {
  const { data, error } = await supabase
    .from('dues_overrides')
    .upsert(
      {
        dues_config_id: duesConfigId,
        student_id: studentId,
        override_type: overrideType, // 'exempt' | 'custom_amount'
        custom_amount: overrideType === 'custom_amount' ? customAmount : null,
        reason,
      },
      { onConflict: 'dues_config_id,student_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Admin: one-time dues/fees ---------------------------------------

export async function createOneTimeDue({ title, description, amount, dueDate, appliesTo, studentIds }) {
  const { data: oneTime, error } = await supabase
    .from('one_time_dues')
    .insert({
      title,
      description,
      amount,
      due_date: dueDate || null,
      applies_to: appliesTo, // 'all' | 'selected'
    })
    .select()
    .single();
  if (error) throw error;

  if (appliesTo === 'selected' && studentIds?.length) {
    const rows = studentIds.map((sid) => ({ one_time_due_id: oneTime.id, student_id: sid }));
    const { error: targetErr } = await supabase.from('one_time_dues_targets').insert(rows);
    if (targetErr) throw targetErr;
  }

  // Generate a dues_instance for every applicable student immediately.
  const targetStudents =
    appliesTo === 'all'
      ? (await supabase.from('students').select('id').eq('enrollment_status', 'active')).data
      : studentIds.map((id) => ({ id }));

  const instanceRows = (targetStudents || []).map((s) => ({
    student_id: s.id,
    source_type: 'one_time',
    one_time_due_id: oneTime.id,
    period_label: title,
    amount_due: amount,
    status: 'pending',
    due_date: dueDate || null,
  }));

  if (instanceRows.length) {
    const { error: instErr } = await supabase.from('dues_instances').insert(instanceRows);
    if (instErr) throw instErr;
  }

  return oneTime;
}

// --- Generate this period's recurring instances -----------------------
// Call this once per period (e.g. monthly) — from an admin action button
// or a scheduled Supabase cron job hitting a small wrapper function.
// Idempotent-ish: skips students who already have an instance with the
// same period_label for this dues_config.

export async function generateRecurringInstancesForPeriod(duesConfigId, periodLabel) {
  const { data: config, error: cfgErr } = await supabase
    .from('dues_config')
    .select('*')
    .eq('id', duesConfigId)
    .single();
  if (cfgErr) throw cfgErr;

  const { data: students, error: studErr } = await supabase
    .from('students')
    .select('id')
    .eq('enrollment_status', 'active');
  if (studErr) throw studErr;

  const { data: overrides } = await supabase
    .from('dues_overrides')
    .select('*')
    .eq('dues_config_id', duesConfigId);
  const overrideMap = new Map((overrides || []).map((o) => [o.student_id, o]));

  const { data: existing } = await supabase
    .from('dues_instances')
    .select('student_id')
    .eq('dues_config_id', duesConfigId)
    .eq('period_label', periodLabel);
  const alreadyHas = new Set((existing || []).map((e) => e.student_id));

  const rows = [];
  for (const s of students) {
    if (alreadyHas.has(s.id)) continue;
    const override = overrideMap.get(s.id);
    if (override?.override_type === 'exempt') {
      rows.push({
        student_id: s.id,
        source_type: 'recurring',
        dues_config_id: duesConfigId,
        period_label: periodLabel,
        amount_due: 0,
        status: 'exempt',
      });
      continue;
    }
    const amount = override?.override_type === 'custom_amount' ? override.custom_amount : config.amount;
    rows.push({
      student_id: s.id,
      source_type: 'recurring',
      dues_config_id: duesConfigId,
      period_label: periodLabel,
      amount_due: amount,
      status: 'pending',
      due_date: config.ends_on,
    });
  }

  if (rows.length) {
    const { error } = await supabase.from('dues_instances').insert(rows);
    if (error) throw error;
  }
  return rows.length;
}

// --- Reads used by both dashboard and collect flow ---------------------

export async function getOutstandingDuesForStudent(studentId) {
  const { data, error } = await supabase
    .from('dues_instances')
    .select('*')
    .eq('student_id', studentId)
    .in('status', ['pending', 'partial', 'overdue'])
    .order('due_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getDuesHistoryForStudent(studentId) {
  const { data, error } = await supabase
    .from('dues_instances')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Mark instances overdue whose due_date has passed and are still unpaid.
// Run this periodically (e.g. on dashboard load, or a daily cron).
export async function sweepOverdueInstances() {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('dues_instances')
    .update({ status: 'overdue' })
    .lt('due_date', today)
    .in('status', ['pending', 'partial']);
  if (error) throw error;
}
