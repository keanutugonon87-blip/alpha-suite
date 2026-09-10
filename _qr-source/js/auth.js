// =====================================================================
// Student login: "Student ID + password" on the surface, backed by
// Supabase Auth's email/password under the hood. Supabase Auth always
// wants an email, so each student ID maps to a stable synthetic
// address like "2024-00123@students.alpha28.local" — students never
// see or type this, they only ever type their student ID.
// =====================================================================
import { supabase } from './supabase-client.js';

const STUDENT_EMAIL_DOMAIN = 'students.alpha28.local';

export function studentIdToEmail(studentId) {
  const clean = studentId.trim().toLowerCase().replace(/\s+/g, '');
  return `${clean}@${STUDENT_EMAIL_DOMAIN}`;
}

export async function studentLogin(studentId, password) {
  const email = studentIdToEmail(studentId);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Student ID or password is incorrect.');
  return data;
}

export async function studentLogout() {
  await supabase.auth.signOut();
}

// -----------------------------------------------------------------
// Admin/Treasurer-side: create a new student account.
// This should be called from an authenticated officer session.
// It creates the Auth user (synthetic email) and the students row,
// then issues the QR token via the Edge Function.
//
// NOTE: creating another user's Auth account normally requires the
// service role key, which cannot live in browser JS. In practice you
// have two options — pick one when wiring this up:
//   (a) Have the STUDENT do a one-time self-service signup (enter
//       their student ID + set a password) which Supabase Auth allows
//       client-side via signUp(); an officer pre-creates the `students`
//       row and the student's signUp() links to it by student_id.
//   (b) Add a small "create-student" Edge Function (service role) for
//       true bulk admin creation, mirroring the qr-token function.
// This file implements option (a), the one bulk-onboarding flow that
// works without extra server code; the bulk-create Edge Function is a
// straightforward extension of qr-token if you want option (b) too.
// -----------------------------------------------------------------

export async function studentSelfSignup({ studentId, password, fullName }) {
  const email = studentIdToEmail(studentId);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  // Link (or create) the students row for this auth user.
  const { data: existing } = await supabase
    .from('students')
    .select('id, auth_user_id')
    .eq('student_id', studentId)
    .maybeSingle();

  if (existing) {
    if (existing.auth_user_id) {
      throw new Error('This student ID already has an account. Please log in instead.');
    }
    await supabase
      .from('students')
      .update({ auth_user_id: data.user.id, full_name: fullName })
      .eq('id', existing.id);
    return existing.id;
  }

  throw new Error(
    'No pre-registered record found for this Student ID. Ask your Treasurer to add you to the roster first.'
  );
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

// -----------------------------------------------------------------
// Officer login: plain email/password via Supabase Auth. Unlike
// students, officers have no pre-seeded row to "claim" — signing up
// only creates the Auth account itself. It grants NO access on its
// own: every sensitive action is gated by officer_roles, which only
// the Mayor/admin populates (by hand, matching the officer's email)
// after they've signed up once. An unassigned account can log in but
// can't do anything.
// -----------------------------------------------------------------

export async function officerLogin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Email or password is incorrect.');
  return data;
}

export async function officerSelfSignup({ email, password, fullName }) {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (error) throw error;
  return data;
}

export async function officerLogout() {
  await supabase.auth.signOut();
}
