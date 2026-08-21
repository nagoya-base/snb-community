// 共通ユーティリティ。フォームジェネレーター全体で使う純粋関数のみを置く。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * "2026-09-05" -> "9/5（土）"。不正な日付は空文字を返す。
 *
 * 実行環境のローカルタイムゾーンに依存しないよう、UTC基準で日付を構築・読み出す
 * （例えばタイムゾーンがUTCのブラウザ/OSでは、"...T00:00:00+09:00" をローカル
 * getDate()/getDay()で読むと1日ずれる。本来の暦日は時差に関係なく一意なので、
 * Date.UTCで組み立ててUTCアクセサで読めば環境非依存で常に正しい値になる）。
 */
export function formatDateLabel(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}（${WEEKDAYS[dt.getUTCDay()]}）`;
}

/** "2026-09-05" -> "date_0905" */
export function dateToKey(isoDate) {
  if (!isoDate) return '';
  const [, m, d] = isoDate.split('-');
  if (!m || !d) return '';
  return `date_${m}${d}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

/** DOMへ書き出さない前提の値も含め、生成HTML文字列に混入するテキストは必ずこれを通す。 */
export function safeText(value) {
  return escapeHtml(value);
}

const SLUG_PATTERN = /^[a-z][a-z0-9_]{2,60}$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

export function isValidQuestionKey(key) {
  return typeof key === 'string' && /^[a-z][a-z0-9_]{1,60}$/.test(key);
}

/** UTF-8文字列をGitHub Contents APIが要求するbase64へ変換する（マルチバイト安全）。 */
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
