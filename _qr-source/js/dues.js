// =====================================================================
// Dues configuration (admin/treasurer) + status computation.
// ⭐ FIXED: Added error handling, atomic server-side functions,
// and server-side timestamp for sweep_overdue_instances()
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
// ⭐ FIXED: Now uses server-side atomic RPC function for consistency
// Call this once per period (e.g. monthly) — from an admin action button
// or a scheduled Supabase cron job hitting a small wrapper function.

export async function generateRecurringInstancesForPeriod(duesConfigId, periodLabel) {
  // Use the server-side atomic function instead of client-side logic
  const { data, error } = await supabase.rpc('generate_recurring_instances', {
    p_dues_config_id: duesConfigId,
    p_period_label: periodLabel,
  });

  if (error) throw new Error(`Failed to generate recurring instances: ${error.message}`);
  
  // data.created_count is the number of instances created
  return data?.[0]?.created_count || 0;
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

// ⭐ FIXED: Uses server-side RPC function with CURRENT_DATE for atomicity
// Mark instances overdue whose due_date has passed and are still unpaid.
// Run this periodically (e.g. on dashboard load, or a daily cron).
export async function sweepOverdueInstances() {
  const { data, error } = await supabase.rpc('sweep_overdue_instances');
  
  if (error) {
    console.warn('sweep_overdue_instances error:', error);
    // Don't throw — this is non-critical
    return 0;
  }
  
  return data?.[0]?.updated_count || 0;
}
