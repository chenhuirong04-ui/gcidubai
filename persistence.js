// persistence.js —— 云端持久化模块（一次性最终版）
// 只负责存取 state，不碰任何业务逻辑

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://bpjhixdqhdwgptdgikyr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_FMFF5BEzDJzoTWWfMjujcQ_3xRGFnZD";

const TABLE = "app_state";
const APP_ID = "icar_bookkeeping";   // 固定，跨设备/无痕的关键
const LS_KEY = APP_ID;

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

// ---------- localStorage 兜底 ----------
function lsLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function lsSave(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state ?? null));
  } catch {}
}

// ---------- Supabase ----------
async function sbLoad() {
  const { data, error } = await sb
    .from(TABLE)
    .select("state")
    .eq("app_id", APP_ID)
    .maybeSingle();
  if (error) throw error;
  return data?.state ?? null;
}
async function sbSave(state) {
  const payload = {
    app_id: APP_ID,
    state: state ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from(TABLE).upsert(payload, {
    onConflict: "app_id",
  });
  if (error) throw error;
}

// ---------- 防抖写入 ----------
let timer = null;
let pending = null;
let saving = false;

async function flush() {
  if (saving) return;
  saving = true;

  const state = pending;
  pending = null;

  // 本地先落
  lsSave(state);

  try {
    await sbSave(state);
  } catch {
    // 云端失败不影响现有行为
  } finally {
    saving = false;
    if (pending !== null) await flush();
  }
}

// ---------- 对外接口（只这两个） ----------
export async function loadAppState() {
  // 云端优先（无痕 / 换设备）
  try {
    const cloud = await sbLoad();
    if (cloud !== null && cloud !== undefined) {
      lsSave(cloud);
      return cloud;
    }
  } catch {}

  // 本地兜底
  const local = lsLoad();

  // 自动补写云端（迁移）
  if (local !== null && local !== undefined) {
    try {
      await sbSave(local);
    } catch {}
  }
  return local;
}

export function saveAppState(state) {
  // 立即本地保存
  lsSave(state);

  // 云端防抖
  pending = state;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush().catch(() => {}), 300);
}
