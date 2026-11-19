// Pure helpers for chapter attachment download: naming, URL candidates, type checks.
// No DOM and no chrome.* here, so they can be unit-tested with node --test.

export const DOC_EXTS = [
  'pdf', 'ppt', 'pptx', 'pptm', 'pot', 'potx', 'doc', 'docx', 'docm', 'rtf',
  'xls', 'xlsx', 'xlsm', 'csv', 'txt', 'zip', 'rar', '7z', 'wps', 'et', 'dps', 'ofd'
];
export const MEDIA_EXTS = ['mp4', 'm4v', 'flv', 'm3u8', 'mp3', 'm4a', 'wav', 'avi', 'mov', 'wmv', 'mkv', 'webm'];
const TYPE_MAP = {
  pdf: 'pdf', ppt: 'ppt', pptx: 'pptx', pptm: 'pptm', doc: 'doc', docx: 'docx',
  xls: 'xls', xlsx: 'xlsx', zip: 'zip', video: 'mp4', audio: 'mp3', txt: 'txt'
};
const MIME_EXT = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/rar': 'rar',
  'application/x-rar-compressed': 'rar',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3'
};
// The object storage the page itself loads documents from. Only used when the page
// did not leave us an exact URL in its own network history.
export const ORIGIN_BASE = 'https://p.ananas.chaoxing.com/star3/origin/';

const FILE_TAIL = /\.(pdf|pptx?|pptm|potx?|docx?|docm|rtf|xlsx?|xlsm|csv|txt|zip|rar|7z|wps|et|dps|ofd|mp4|m4v|flv|mp3|m4a|wav|avi|mov|wmv|mkv|webm)$/i;
const PAGE_TAIL = /\.(html?|jsp|do|action|php|aspx?)$/i;

export function extensionOf(value = '') {
  const s = String(value).split(/[?#]/)[0].trim();
  const m = s.match(/\.([A-Za-z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : '';
}

export function stripExtension(name = '') {
  return String(name).replace(/\.[A-Za-z0-9]{2,5}$/, '').trim();
}

// Windows rejects \ / : * ? " < > | and trailing dots or spaces in file names.
export function safeName(value, fallback = '课件') {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const clipped = cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
  return clipped || fallback;
}

// Every https chaoxing URL the page reported for this attachment, best guesses kept apart.
export function urlsOf(att = {}) {
  const out = [];
  const add = raw => {
    let s = String(raw ?? '').trim().replace(/^http:\/\//i, 'https://');
    if (!/^https:\/\/[^/\s]+chaoxing\.com\//i.test(s)) return;
    if (!out.includes(s)) out.push(s);
  };
  if (Array.isArray(att.urls)) att.urls.forEach(add);
  for (const key of ['url', 'downloadUrl', 'download', 'pdf', 'src', 'fileUrl', 'href', 'previewUrl', 'viewUrl', 'objectUrl']) add(att[key]);
  return out;
}

export function attachmentExt(att = {}) {
  const explicit = String(att.ext || '').toLowerCase().replace(/^\./, '');
  if (explicit) return explicit;
  const fromName = extensionOf(att.name);
  if (fromName) return fromName;
  const urls = urlsOf(att).filter(isFileUrl);
  for (const u of urls) {
    const ext = extensionOf(u);
    if (ext) return ext;
  }
  return (TYPE_MAP[String(att.type || '').toLowerCase()] || '').toLowerCase();
}

export const isDocument = att => DOC_EXTS.includes(attachmentExt(att));
export const isMedia = att => MEDIA_EXTS.includes(attachmentExt(att));

// A URL that already ends in a document extension is the only shape we can trust blind:
// chaoxing's extension-less /star3/origin/<id> answers with an HTML viewer page.
export function isFileUrl(url = '') {
  const path = String(url).split(/[?#]/)[0].replace(/\/+$/, '');
  const tail = path.split('/').pop() || '';
  return FILE_TAIL.test(tail);
}

export function isPageUrl(url = '') {
  const path = String(url).split(/[?#]/)[0].replace(/\/+$/, '');
  const tail = path.split('/').pop() || '';
  return PAGE_TAIL.test(tail);
}

// The viewer asks /ananas/status/<id>?flag=normal for a JSON manifest; that endpoint is never
// a file, it only carries the real file URLs (download / pdf).
export const isStatusUrl = url => /\/ananas\/status\//i.test(String(url || ''));

export const hasFlagParam = url => /[?&]flag=/i.test(String(url));

function withFlag(url = '') {
  const s = String(url);
  if (!s) return '';
  return s + (s.includes('?') ? '&' : '?') + 'flag=1';
}

export function withExtSuffix(url = '', ext = '') {
  const s = String(url);
  if (!s || !ext) return '';
  const [path, ...rest] = s.split('?');
  if (isFileUrl(path)) return s;
  const trimmed = path.replace(/\/+$/, '');
  return `${trimmed}.${ext}${rest.length ? '?' + rest.join('?') : ''}`;
}

// Candidate download URLs, best first. Every one of them still has to pass a
// content-type check before it is saved, so wrong guesses cost one request, not a bad file.
export function candidateUrls(att = {}) {
  const ext = attachmentExt(att);
  const id = String(att.objectid || '').trim();
  const given = urlsOf(att);
  const out = [];
  const add = url => {
    const u = String(url || '').trim();
    if (!u) return;
    if (isPageUrl(u) || isStatusUrl(u)) return;
    if (!out.includes(u)) out.push(u);
  };
  const flagged = given.filter(hasFlagParam);
  const files = given.filter(isFileUrl);
  const plain = given.filter(u => !hasFlagParam(u) && !isFileUrl(u) && !isPageUrl(u) && !isStatusUrl(u));

  files.filter(hasFlagParam).forEach(add);
  flagged.filter(u => !isFileUrl(u)).forEach(add);
  files.forEach(add);
  for (const u of plain) add(withExtSuffix(u, ext));
  if (id) {
    const base = ORIGIN_BASE + encodeURIComponent(id);
    if (ext) add(`${base}.${ext}`);
    add(withFlag(base));
  }
  for (const u of plain) add(withFlag(u));
  for (const u of plain) add(u);
  return out;
}

export function downloadUrlFor(att = {}) {
  return candidateUrls(att)[0] || '';
}

// 'file' = a real document/media body; 'web' = an HTML/JSON answer page; 'image' = a thumbnail.
export function mimeKind(mime = '') {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (!m) return 'unknown';
  if (/^(text\/html|application\/xhtml|application\/json|text\/xml|application\/xml|text\/javascript|application\/javascript)/.test(m)) return 'web';
  if (m === 'text/plain') return 'file';
  if (/^application\/(pdf|msword|rtf|ofd|zip|x-zip-compressed|x-7z-compressed|x-rar-compressed|vnd\.ms-|vnd\.openxmlformats|octet-stream|vnd\.oasis)/.test(m)) return 'file';
  if (/^(video|audio)\//.test(m)) return 'file';
  if (/^image\//.test(m)) return 'image';
  return 'unknown';
}

export function extFromMime(mime = '') {
  return MIME_EXT[String(mime || '').toLowerCase().split(';')[0].trim()] || '';
}

// The server often sends the real file name; prefer it over anything we guessed.
export function nameFromDisposition(value = '') {
  const s = String(value || '');
  let m = s.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (m) {
    try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch {}
  }
  m = s.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (m) {
    const v = m[1].trim().replace(/^"|"$/g, '');
    try { return decodeURIComponent(v); } catch { return v; }
  }
  return '';
}

const compact = s => String(s || '').replace(/\s+/g, '').replace(/^[\d.、,，_\-—\s]+/, '');

// Name each file after the chapter heading shown in the course catalog.
export function fileBaseFor(chapterTitle, att = {}, index = 0, count = 1) {
  const chapter = safeName(stripExtension(chapterTitle || ''), '');
  const attBase = safeName(stripExtension(att.name || ''), '');
  if (!chapter) return attBase || (count > 1 ? `课件_${index + 1}` : '课件');
  if (count <= 1) return chapter;
  const same = !attBase || (compact(attBase) && (compact(chapter).includes(compact(attBase)) || compact(attBase).includes(compact(chapter))));
  return same ? `${chapter}_${index + 1}` : `${chapter}_${attBase}`;
}

export function fileNameFor(chapterTitle, att = {}, index = 0, count = 1, forcedExt = '') {
  const ext = String(forcedExt || attachmentExt(att) || '').toLowerCase();
  const base = fileBaseFor(chapterTitle, att, index, count);
  return ext ? `${base}.${ext}` : base;
}

// The page reports the same file from several places (JS setting, iframe data, network
// history, links). Keep one row per file, preferring rows that carry a name and a URL.
export function dedupeAttachments(list = []) {
  const byKey = new Map();
  for (const raw of list) {
    if (!raw) continue;
    const objectid = String(raw.objectid || '').trim();
    const urls = urlsOf(raw);
    const url = String(raw.url || urls[0] || '').trim();
    if (!objectid && !urls.length && !url) continue;
    const key = (objectid || url).toLowerCase();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...raw, objectid, url, urls });
      continue;
    }
    const merged = {
      ...prev,
      ...raw,
      objectid: prev.objectid || objectid,
      name: prev.name || raw.name,
      url: prev.url || url,
      urls: [...new Set([...(prev.urls || []), ...urls])],
      type: prev.type || raw.type,
      size: prev.size || raw.size,
      from: [prev.from, raw.from].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join('+')
    };
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

export function formatSize(bytes = 0) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Downloads folder layout: 学习通课件/<课程编号>/<文件>.  Empty course id falls back to a flat folder.
export function downloadPath(courseId, name) {
  const course = safeName(courseId || '', '');
  const file = safeName(name, '课件');
  return course ? `学习通课件/${course}/${file}` : `学习通课件/${file}`;
}
