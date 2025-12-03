// js/auth.js

// 1. Configure Supabase client
// Get these from your Supabase project settings:
// - Project URL (API -> "Project URL")
// - anon public key (API -> "anon public")
const SUPABASE_URL = "https://zzclyitigpxoqbhzuzrs.supabase.co"; // keep if this is your real URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6Y2x5aXRpZ3B4b3FiaHp1enJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MDczMTIsImV4cCI6MjA4MDE4MzMxMn0.LAyR7XCgkUPBd00KAPELmq3XQcwDiMsHo8UU94jBQOY";       // NO "..." anywhere

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 2. Helper: require the user to be logged in (for index.html)
async function requireAuthOrRedirect() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    window.location.href = "login.html";
    return null;
  }

  return user;
}

// 3. Helper: load the current profile (for app UI)
async function getCurrentProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error loading profile:", error);
    return null;
  }

  return data;
}

// 4. Logout helper
async function logoutAndRedirect() {
  await supabase.auth.signOut();
  window.location.href = "login.html";
}

// Make helpers available globally
window.supabaseClient = supabase;
window.requireAuthOrRedirect = requireAuthOrRedirect;
window.getCurrentProfile = getCurrentProfile;
window.logoutAndRedirect = logoutAndRedirect;
