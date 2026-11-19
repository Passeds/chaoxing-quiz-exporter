// Run with: node --test test.mjs
// No browser required: pure core functions plus the injected chapter-quiz text parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {validateWork, validateQuiz, makeBank, prepareChapters, toHtml, toCsv, clean, pickQuizzes} from './extension/core.mjs';
import {extensionOf, safeName, fileNameFor, fileBaseFor, downloadUrlFor, candidateUrls, dedupeAttachments, isDocument, isMedia, isFileUrl, isStatusUrl, urlsOf, withExtSuffix, mimeKind, extFromMime, nameFromDisposition, downloadPath} from './extension/documents.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function loadInjected(name) {
  const source = readFileSync(join(here, 'extension', 'extract.js'), 'utf8');
  const match = source.match(new RegExp('export function ' + name + '\\(\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(match, 'function ' + name + ' must remain self-contained and end at column 0');
  return new Function('return (' + match[0].replace(/^export /, '') + ')')();
}

function withPage(text, href, opts = {}) {
  const previous = {document: globalThis.document, location: globalThis.location};
  globalThis.document = {
    title: '第一单元 卫生法基础知识-单元检测',
    body: {innerText: text},
    querySelectorAll: () => [],
    querySelector: sel => opts.qs ? opts.qs(sel) : null
  };
  globalThis.location = {href};
  return () => { globalThis.document = previous.document; globalThis.location = previous.location; };
}

const quizPage = [
  '第三部分 单元检测',
  '第一单元 卫生法基础知识-单元检测',
  '任务点已完成',
  '题量 2 满分 100.0 截止时间 2026-12-31 23:59:00',
  '最高分 100 分',
  '重新测验 100 分',
  '第1次作答',
  '本次成绩 100 分',
  '一、单选题（共2题）',
  '1【单选题】下列关于行政法效力等级，由高到低排列，正确的是',
  'A. 宪法、法律、行政法规、部门规章',
  'B. 宪法、规范性文件、法律、行政法规',
  'C. 宪法、法律、地方性法规、行政法规',
  'D. 宪法、行政法规、法律、地方性法规',
  'E. 宪法、法律、部门规章、地方性法规',
  'AI讲解',
  '我的答案：A',
  '正确答案：A',
  '答案解析：《中华人民共和国立法法》规定，宪法具有最高的法律效力，一切法律、行政法规都不得同宪法相抵触。',
  '规范性文件的效力最低，故本题答案为 A。',
  '知识点： 卫生法效力层级',
  '✓ 1.5 分',
  '2【单选题】关于卫生法的特征，下列说法错误的是',
  'A. 卫生法具有法律规范性',
  'B. 卫生法具有国家强制性',
  'C. 卫生法以保护公民健康为根本',
  'D. 卫生法可以由任何机关行使',
  'AI讲解',
  '我的答案：E',
  '正确答案：D',
  '答案解析：卫生法由国家制定或认可，并由国家强制力保证实施，并非任何机关都可以行使。',
  '✓ 1.5 分'
].join('\n');

const work = (id, title, questions) => ({workId: id, title, expected: questions.length, questions});
const q = (stem, answer, mine, extra = {}) => ({
  id: stem, type: '单选题', stem, options: ['A. 甲', 'B. 乙'], answer, mine,
  explanation: '', explanationImages: [], images: [], notes: [], ...extra
});

test('validateWork keeps the original strict题量 check', () => {
  assert.equal(validateWork(work('w1', '作业一', [q('题干一', 'A', 'A')])).workId, 'w1');
  assert.throws(() => validateWork({title: 'x', expected: 2, questions: [q('题干', 'A', 'A')]}), /题量不匹配/);
  assert.throws(() => validateWork({title: 'x', expected: 1, questions: [q('', 'A', 'A')]}), /题干/);
});

test('extractChapterQuiz reads visible text without any class names', () => {
  const restore = withPage(quizPage, 'https://mooc1.chaoxing.com/exam/answer?courseId=123&chapterId=456');
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.expected, 2);
    assert.equal(result.courseId, '123');
    assert.ok(/^quiz-.*456/.test(result.workId), 'workId keeps the page id and the quiz title');
    assert.equal(result.source, 'quiz');
    assert.deepEqual(result.sectionCounts, [2]);
    assert.equal(result.questions.length, 2);

    const first = result.questions[0];
    assert.equal(first.type, '单选题');
    assert.match(first.stem, /行政法效力等级/);
    assert.equal(first.options.length, 5);
    assert.equal(first.answer, 'A');
    assert.equal(first.mine, 'A');
    assert.equal(first.knowledgePoints, '卫生法效力层级');
    assert.equal(first.score, '1.5');
    assert.match(first.explanation, /宪法具有最高的法律效力/);
    assert.match(first.explanation, /规范性文件的效力最低/);
    assert.doesNotMatch(first.explanation, /AI讲解/);

    const second = result.questions[1];
    assert.equal(second.answer, 'D');
    assert.equal(second.mine, 'E');
    assert.equal(second.options.length, 4);
    assert.ok(validateQuiz(result));
  } finally { restore(); }
});

test('courseId falls back to the real #curCourseId hidden field', () => {
  const restore = withPage(quizPage, 'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?clazzid=152556092', {
    qs: sel => sel.includes('curCourseId') ? {value: '265420739'} : null
  });
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.courseId, '265420739');
    assert.doesNotMatch(result.workId, /clazzid|cpi=|&t=/);
  } finally { restore(); }
});

test('validateQuiz keeps a page that only rendered part of the questions', () => {
  const partial = validateQuiz({title: '单元检测', expected: 65, questions: [q('题干', 'A', 'A')]});
  assert.equal(partial.complete, false);
  assert.equal(partial.missing, 64);
  const whole = validateQuiz({title: '单元检测', expected: 1, questions: [q('题干', 'A', 'A')]});
  assert.equal(whole.complete, true);
  assert.throws(() => validateQuiz({title: '单元检测', expected: 0, questions: []}), /识别到题目/);
});

// Real pages keep the answer labels in inline spans, so several of them arrive on one line.
test('extractChapterQuiz splits answer labels that share one line', () => {
  const text = [
    '题量 65 满分 100.0 截止时间 2026-12-31 23:59:00',
    '一、单选题(共65题)',
    '1.【单选题】下列关于卫生法的描述，由国家制定、认可并以国家强制力保证实施',
    'A. 宪法、法律、行政法规、部门规章',
    'B. 宪法、规范性文件、法律、行政法规',
    'C. 宪法、法律、地方性法规、行政法规',
    'D. 宪法、行政法规、法律、地方性法规',
    '我的答案：A  正确答案：A  ✓ 1.5分',
    '答案解析：《基本医疗卫生与健康促进法》自2020年6月1日起施行。',
    '知识点：卫生法概述',
    '2. 【单选题】关于卫生法特征的说法，错误的是',
    'A. 甲',
    'B. 乙',
    '我的答案：B 正确答案：A 1.5分',
    '答案解析：解析二。'
  ].join('\n');
  const restore = withPage(text, 'https://mooc1.chaoxing.com/exam/answer?courseId=123&chapterId=456');
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.expected, 65);
    assert.deepEqual(result.sectionCounts, [65]);
    assert.equal(result.questions.length, 2);

    const first = result.questions[0];
    assert.match(first.stem, /国家制定/);
    assert.equal(first.options.length, 4);
    assert.equal(first.mine, 'A');
    assert.equal(first.answer, 'A');
    assert.equal(first.score, '1.5');
    assert.equal(first.knowledgePoints, '卫生法概述');
    assert.match(first.explanation, /2020年6月1日/);

    const second = result.questions[1];
    assert.equal(second.mine, 'B');
    assert.equal(second.answer, 'A');
    assert.equal(second.score, '1.5');

    const saved = validateQuiz(result);
    assert.equal(saved.complete, false);
    assert.equal(saved.missing, 63);
  } finally { restore(); }
});

// Some builds put the number, the badge and the stem in separate spans: innerText splits them.
test('extractChapterQuiz re-joins fragments that innerText puts on separate lines', () => {
  const text = [
    '题量 2 满分 100.0',
    '一、单选题（共2题）',
    '1',
    '【单选题】下列关于卫生法的描述，由国家制定、认可',
    'A',
    '宪法、法律、行政法规、部门规章',
    'B',
    '宪法、规范性文件、法律、行政法规',
    '我的答案',
    'A',
    '正确答案',
    'A',
    '答案解析',
    '《基本医疗卫生与健康促进法》自2020年6月1日起施行。',
    '知识点',
    '卫生法概述',
    '2',
    '【单选题】关于卫生法的特征，说法错误的是',
    'A',
    '甲',
    'B',
    '乙',
    '我的答案',
    'B',
    '正确答案',
    'A'
  ].join('\n');
  const restore = withPage(text, 'https://mooc1.chaoxing.com/exam/answer?courseId=123&chapterId=456');
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.questions.length, 2);
    const first = result.questions[0];
    assert.match(first.stem, /国家制定/);
    assert.deepEqual(first.options, ['A. 宪法、法律、行政法规、部门规章', 'B. 宪法、规范性文件、法律、行政法规']);
    assert.equal(first.mine, 'A');
    assert.equal(first.answer, 'A');
    assert.equal(first.knowledgePoints, '卫生法概述');
    assert.match(first.explanation, /2020年6月1日/);
    assert.equal(result.questions[1].answer, 'A');
    assert.equal(result.questions[1].mine, 'B');
  } finally { restore(); }
});

// If the number is painted by CSS it never reaches innerText: number the badges instead.
test('extractChapterQuiz numbers type badges when no question number exists', () => {
  const text = [
    '题量 2 满分 100.0',
    '一、单选题（共2题）',
    '【单选题】题干一',
    'A. 甲',
    'B. 乙',
    '我的答案：A',
    '正确答案：A',
    '【单选题】题干二',
    'A. 丙',
    'B. 丁',
    '我的答案：B',
    '正确答案：B'
  ].join('\n');
  const restore = withPage(text, 'https://mooc1.chaoxing.com/exam/answer?courseId=123&chapterId=456');
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.questions.length, 2);
    assert.deepEqual(result.questions.map(q => q.number), [1, 2]);
    assert.equal(result.questions[0].stem, '题干一');
    assert.equal(result.questions[1].answer, 'B');
  } finally { restore(); }
});

// A minimal fake DOM that mirrors the real Chaoxing answer-card structure, so the selector-based
// path (not just the text fallback) is exercised exactly the way the live page renders it.
class El {
  constructor(tag, {cls = '', text = '', attrs = {}, children = [], src = '', width = 0} = {}) {
    this.tag = tag;
    this.cls = String(cls).split(/\s+/).filter(Boolean);
    this.className = String(cls);
    this.id = attrs.id || '';
    this.text = text;
    this.attrs = attrs;
    this.children = children;
    this.src = src;
    this.currentSrc = src;
    this.naturalWidth = width;
    for (const c of children) c.parent = this;
  }
  get innerText() {
    if (!this.children.length) return this.text;
    return [this.text, ...this.children.map(c => c.innerText)].filter(Boolean).join('\n');
  }
  get textContent() { return this.innerText; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter(n => matchSel(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parent; } return null; }
  getAttribute(name) { return this.attrs[name] ?? null; }
}

function matchCompound(n, comp) {
  if (!n || !n.tag) return false;
  let s = comp.trim();
  const tagM = s.match(/^[a-zA-Z][\w-]*/);
  if (tagM) { if (n.tag.toLowerCase() !== tagM[0].toLowerCase()) return false; s = s.slice(tagM[0].length); }
  const tokRe = /\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:(\^?=)"?'?([^\]"']*)"?'?)?\]/g;
  let m, found = false;
  while ((m = tokRe.exec(s))) {
    found = true;
    if (m[1]) { if (!n.cls.includes(m[1])) return false; }
    else if (m[2]) { if (n.id !== m[2]) return false; }
    else {
      const val = n.attrs[m[3]];
      if (val == null) return false;
      if (m[4] === '^=') { if (!String(val).startsWith(m[5])) return false; }
      else if (m[4] === '=') { if (String(val) !== m[5]) return false; }
    }
  }
  return found || !!tagM;
}

function matchChain(n, sel) {
  const parts = sel.trim().split(/\s+/);
  if (!matchCompound(n, parts.at(-1))) return false;
  let i = parts.length - 2, cur = n.parent;
  while (i >= 0) { if (!cur) return false; if (matchCompound(cur, parts[i])) i--; cur = cur.parent; }
  return true;
}

const matchSel = (n, sel) => sel.split(',').some(s => matchChain(n, s));

function withDom({header, cards, href}) {
  const previous = {document: globalThis.document, location: globalThis.location};
  const root = new El('body', {
    children: [new El('div', {cls: 'pageHead', text: header}), ...cards]
  });
  globalThis.document = {
    title: '查看已批阅作业',
    body: root,
    querySelectorAll: sel => root.querySelectorAll(sel),
    querySelector: sel => root.querySelector(sel)
  };
  globalThis.location = {href};
  return () => { globalThis.document = previous.document; globalThis.location = previous.location; };
}

const OPTIONS = [
  ['A', '宪法、法律、行政法规、部门规章'],
  ['B', '宪法、规范性文件、法律、行政法规'],
  ['C', '宪法、法律、地方性法规、行政法规'],
  ['D', '宪法、行政法规、法律、地方性法规'],
  ['E', '宪法、法律、部门规章、地方性法规']
];

function answerCard(num, {
  type = '单选题', stem = '下列关于法的效力等级，由高到低排列，正确的是',
  mine = 'A', answer = 'A', expl = '《中华人民共和国立法法》第九十八条 宪法具有最高的法律效力。',
  kp = '卫生法的效力', score = '1.5', options = OPTIONS, stemImg = '', explImg = ''
} = {}) {
  const qtContent = new El('div', {cls: 'clearfix font-cxsecret fontLabel qtContent', children: [
    new El('span', {cls: 'newZy_TItle', text: '【' + type + '】'}),
    new El('span', {text: stem})
  ]});
  if (stemImg) { const im = new El('img', {src: stemImg, width: 300}); im.parent = qtContent; qtContent.children.push(im); }
  const explBox = new El('div', {cls: 'fl answerCon', text: expl});
  if (explImg) { const im = new El('img', {src: explImg, width: 300}); im.parent = explBox; explBox.children.push(im); }
  const card = new El('div', {
    cls: 'TiMu newTiMu ans-cc singleQuesId',
    attrs: {id: 'question' + (400000 + num), data: String(400000 + num)},
    children: [
      new El('div', {cls: 'Zy_TItle clearfix', children: [
        new El('i', {cls: 'fl', text: String(num)}),
        qtContent
      ]}),
      new El('ul', {cls: 'Zy_ulTop qtDetail', children: options.map(([letter, text]) =>
        new El('li', {cls: 'clearfix', children: [
          new El('i', {cls: 'fl', text: letter + '、'}),
          new El('a', {cls: 'fl', text, attrs: {href: 'javascript:void(0)'}})
        ]})
      )}),
      new El('div', {cls: 'newAnswerBx', children: [
        new El('div', {cls: 'myAnswerBx marBot16', children: [
          new El('div', {cls: 'myAnswer', children: [
            new El('span', {cls: 'answerFont fl', text: '我的答案：'}),
            new El('div', {cls: 'fl answerCon', text: mine})
          ]}),
          new El('div', {cls: 'answerScore', children: [
            new El('div', {cls: 'fr newAnswerScore', children: [
              new El('span', {cls: 'scoreNum', text: score}),
              new El('span', {text: '分'})
            ]})
          ]})
        ]}),
        new El('div', {cls: 'correctAnswerBx marBot16', children: [
          new El('div', {cls: 'correctAnswer', children: [
            new El('span', {cls: 'answerFont fl', text: '正确答案：'}),
            new El('div', {cls: 'fl answerCon', text: answer})
          ]})
        ]}),
        new El('div', {cls: 'answerKeyBx marBot16 colorGray', children: [
          new El('span', {cls: 'answerFont fl', text: '答案解析：'}),
          explBox
        ]}),
        new El('div', {cls: 'knowledgePointBx colorGray', children: [
          new El('span', {cls: 'answerFont fl', text: '知识点：'}),
          new El('div', {cls: 'fl answerCon', children: [
            new El('ul', {cls: 'knowledgeList', children: [
              new El('li', {attrs: {title: kp}, children: [new El('a', {text: kp})]})
            ]})
          ]})
        ]}),
        new El('div', {cls: 'aiExplain', text: 'AI讲解：这是机器生成的解释，不应被采集。'})
      ]})
    ]
  });
  return new El('div', {cls: 'aiArea', children: [new El('div', {cls: 'aiAreaContent', children: [card]})]});
}

test('extractChapterQuiz reads every .TiMu card instead of collapsing them', () => {
  const cards = Array.from({length: 65}, (_, i) => answerCard(i + 1, {
    stem: '第' + (i + 1) + '题：下列关于法的效力等级，由高到低排列，正确的是',
    mine: i % 2 ? 'B' : 'A',
    answer: 'A',
    expl: '第' + (i + 1) + '题解析：《立法法》第九十八条 宪法具有最高的法律效力。',
    kp: '知识点' + (i + 1)
  }));
  const header = [
    '章节测验', '已完成', '第一单元 卫生法基础知识-单元检测',
    '题量: 65 满分: 100.0 截止时间: 2026-12-31 23:59:00',
    '最终成绩100分', '重做 (剩余 100 次)',
    '一. 单选题（共65题）'
  ].join('\n');
  const restore = withDom({header, cards, href: 'https://mooc1.chaoxing.com/mooc-ans/work/selectWorkQuestionYiPiYue?courseId=265420739&workId=57168284&knowledgeid=1193824608'});
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.title, '第一单元 卫生法基础知识-单元检测');
    assert.equal(result.expected, 65);
    assert.equal(result.knowledgeId, '1193824608', 'the quiz knows which chapter it belongs to');
    assert.equal(result.questions.length, 65, '65 cards must yield 65 questions');
    assert.deepEqual(result.questions.map(q => q.number), Array.from({length: 65}, (_, i) => i + 1));
    assert.deepEqual(result.sectionCounts, [65]);

    const first = result.questions[0];
    assert.equal(first.type, '单选题');
    assert.match(first.stem, /^第1题：下列关于法的效力等级/);
    assert.equal(first.options.length, 5);
    assert.deepEqual(first.options, [
      'A. 宪法、法律、行政法规、部门规章',
      'B. 宪法、规范性文件、法律、行政法规',
      'C. 宪法、法律、地方性法规、行政法规',
      'D. 宪法、行政法规、法律、地方性法规',
      'E. 宪法、法律、部门规章、地方性法规'
    ]);
    assert.equal(first.answer, 'A');
    assert.equal(first.mine, 'A');
    assert.equal(first.score, '1.5');
    assert.equal(first.knowledgePoints, '知识点1');
    assert.match(first.explanation, /立法法/);
    assert.doesNotMatch(first.explanation, /AI讲解/);
    assert.equal(first.section, '一. 单选题');
    assert.equal(result.questions[1].mine, 'B');
    assert.equal(result.questions[1].answer, 'A');
    const saved = validateQuiz(result);
    assert.equal(saved.complete, true);
    assert.equal(saved.missing, 0);
    assert.ok(!result.questions.some(x => x.options.some(o => /^[A-J]\.\s*[A-J]\.?$/.test(o))), 'no letter-only options');
  } finally { restore(); }
});

test('extractChapterQuiz keeps multi-choice answers, explanation images and skips AI text', () => {
  const cards = [answerCard(1, {
    type: '多选题', stem: '关于卫生法的特征，下列说法正确的有', mine: 'AB', answer: 'AB',
    expl: '卫生法由国家制定或认可。另外注意：A. 这条不是选项。', score: '2',
    options: [['A', '卫生法具有国家强制性'], ['B', '卫生法以保护公民健康为根本'], ['C', '卫生法可以由任何机关行使']],
    stemImg: 'https://p.ananas.chaoxing.com/star3/origin/stem.png',
    explImg: 'https://p.ananas.chaoxing.com/star3/origin/expl.png'
  })];
  const header = ['章节测验', '基本医疗卫生与健康促进法 单元检测', '题量: 1 满分: 100.0', '一. 多选题（共1题）'].join('\n');
  const restore = withDom({header, cards, href: 'https://mooc1.chaoxing.com/mooc-ans/work/selectWorkQuestionYiPiYue?courseId=265420739&workId=57168285&knowledgeid=1193824608'});
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.expected, 1);
    const q = result.questions[0];
    assert.equal(q.type, '多选题');
    assert.equal(q.options.length, 3, 'explanation text must not be read as options');
    assert.equal(q.answer, 'AB');
    assert.equal(q.mine, 'AB');
    assert.equal(q.score, '2');
    assert.match(q.explanation, /国家制定或认可/);
    assert.equal(q.images.length, 1);
    assert.equal(q.explanationImages.length, 1);
    assert.match(q.explanationImages[0], /expl\.png$/);
  } finally { restore(); }
});

test('extractChapterQuiz reads the legacy .questionLi layout too', () => {
  const card = new El('div', {cls: 'questionLi', children: [
    new El('h3', {children: [new El('span', {cls: 'colorShallow', text: '单选题'}), new El('span', {text: '旧版题干'})]}),
    new El('div', {cls: 'qtContent', text: '旧版题干'}),
    new El('ul', {cls: 'qtDetail', children: [
      new El('li', {text: 'A. 甲'}), new El('li', {text: 'B. 乙'})
    ]}),
    new El('div', {cls: 'rightAnswerContent', text: 'B'}),
    new El('div', {cls: 'stuAnswerContent', text: 'A'})
  ]});
  const restore = withDom({header: '旧版作业题 题量: 1', cards: [card], href: 'https://mooc1.chaoxing.com/exam/answer?courseId=1'});
  try {
    const result = loadInjected('extractChapterQuiz')();
    assert.equal(result.questions.length, 1);
    const q = result.questions[0];
    assert.equal(q.type, '单选题');
    assert.deepEqual(q.options, ['A. 甲', 'B. 乙']);
    assert.equal(q.answer, 'B');
    assert.equal(q.mine, 'A');
  } finally { restore(); }
});

test('makeBank merges sources, keeps notes and normalises multi-choice answers', () => {
  const base = q('同一道题', 'AB', 'BA', {notes: ['选项可能未完整识别，请对照原页面核对']});
  const bank = makeBank([work('w1', '作业一', [base]), work('quiz-2', '第一单元检测', [{...base, id: 'copy'}])]);
  assert.equal(bank.length, 1);
  assert.equal(bank[0].sources.length, 2);
  assert.equal(bank[0].wrong, false);
  assert.ok(bank[0].notes.some(n => /选项可能未完整识别/.test(n)));
  const wrong = makeBank([work('w2', '作业二', [q('另一道题', 'A', 'B')])]);
  assert.equal(wrong[0].wrong, true);
  assert.ok(!JSON.stringify(wrong[0].notes).includes('发展传统权威型'));
});

test('prepareChapters numbers the whole book continuously', () => {
  const chapters = prepareChapters([
    work('w1', '作业一', [q('题一', 'A', 'A'), q('题二', 'B', 'B')]),
    work('quiz-1', '第一单元检测', [q('题三', 'C', 'C')])
  ]);
  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.flatMap(c => c.questions.map(x => x.number)), [1, 2, 3]);
});

test('toHtml keeps the chapter-end answer rule and the explanation switch', () => {
  const many = work('w1', '作业一', Array.from({length: 6}, (_, i) => q('题' + (i + 1), 'A', 'A', {explanation: '解析' + (i + 1)})));
  const html = toHtml([many], '测试题库', {showExplanations: true});
  assert.match(html, /1–5题/);
  assert.match(html, /6题/);
  assert.match(html, /参考答案/);
  assert.match(html, /1题解析/);
  assert.doesNotMatch(html, /份作业 ·/);
  const hidden = toHtml([many], '测试题库', {showExplanations: false});
  assert.doesNotMatch(hidden, /题解析/);
});

test('toHtml can put the answer and explanation right under each question', () => {
  const many = work('w1', '作业一', [q('题一', 'A', 'B', {explanation: '解析一'})]);
  const inline = toHtml([many], '题库', {showExplanations: true, answerMode: 'inline'});
  assert.match(inline, /class="inline-answer"/);
  assert.match(inline, /<strong>正确答案：<\/strong>A/);
  assert.match(inline, /历史错题（我的答案：B）/);
  assert.match(inline, /解析：<\/strong>解析一/);
  assert.doesNotMatch(inline, /参考答案<\/h3>/);
  const end = toHtml([many], '题库', {showExplanations: true});
  assert.match(end, /参考答案<\/h3>/);
  assert.doesNotMatch(end, /class="inline-answer"/);
  const noExpl = toHtml([many], '题库', {showExplanations: false, answerMode: 'inline'});
  assert.match(noExpl, /正确答案/);
  assert.doesNotMatch(noExpl, /解析：/);
});

test('toCsv writes a BOM and neutralises formula injection', () => {
  const csv = toCsv(makeBank([work('w1', '作业一', [q('=1+1', 'A', 'A')])]));
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"'=1\+1"/);
  assert.equal(clean('  a   b '), 'a b');
});

test('pickQuizzes exports only the unit that was collected last', () => {
  const unit1 = {workId: 'quiz-1', title: '第一单元 卫生法基础知识-单元检测', questions: [{number: 1}, {number: 2}]};
  const unit3 = {workId: 'quiz-3', title: '第三单元 传染病防治法律制度-单元检测', questions: [{number: 1}]};
  const all = [unit1, unit3];
  assert.deepEqual(pickQuizzes(all, ['quiz-3'], '__recent').map(x => x.workId), ['quiz-3'],
    'the previous unit must not be dragged into the new export');
  assert.deepEqual(pickQuizzes(all, ['quiz-3'], '__all').map(x => x.workId), ['quiz-1', 'quiz-3']);
  assert.deepEqual(pickQuizzes(all, [], 'quiz-1').map(x => x.workId), ['quiz-1']);
  // Unknown selections fall back to everything instead of silently exporting nothing.
  assert.equal(pickQuizzes(all, ['gone'], '__recent').length, 2);
  assert.equal(pickQuizzes(all, [], 'missing').length, 2);
});

test('documents: keeps extensions and filters out media', () => {
  assert.equal(extensionOf('1.1 绪论.PPTX'), 'pptx');
  assert.equal(extensionOf('https://p.ananas.chaoxing.com/star3/origin/abc.pdf?flag=1'), 'pdf');
  assert.equal(extensionOf('no-extension'), '');
  assert.ok(isDocument({name: '讲义.pptx'}));
  assert.ok(isDocument({url: 'https://p.ananas.chaoxing.com/star3/origin/x.PDF'}));
  assert.ok(!isDocument({name: '第一章.mp4'}));
  assert.ok(isMedia({name: '第一章.mp4'}));
  assert.ok(!isMedia({name: '讲义.pdf'}));
});

test('documents: names each file after the chapter heading', () => {
  // Single attachment: the chapter heading is the name, the attachment supplies the extension.
  assert.equal(fileNameFor('1.1 绪论', {name: '绪论.ppt'}), '1.1 绪论.ppt');
  assert.equal(fileNameFor('1.1 绪论', {name: '1.1绪论.pptx'}), '1.1 绪论.pptx');
  assert.equal(fileNameFor('1.1 绪论', {name: '绪论', type: 'pdf'}), '1.1 绪论.pdf');
  // Several attachments in one chapter: keep the original name as a suffix, numbered when it duplicates.
  assert.equal(fileNameFor('1.1 绪论', {name: '讲义.pdf'}, 0, 2), '1.1 绪论_讲义.pdf');
  assert.equal(fileNameFor('1.1 绪论', {name: '1.1绪论.pdf'}, 1, 2), '1.1 绪论_2.pdf');
  // No chapter title: fall back to the attachment name.
  assert.equal(fileNameFor('', {name: '绪论.ppt'}), '绪论.ppt');
  // Windows-illegal characters are replaced, not silently dropped mid-name.
  assert.equal(fileNameFor('第一章: 绪论', {name: 'x.pdf'}), '第一章 绪论.pdf');
  assert.equal(safeName('a/b:c*?"<>|'), 'a b c');
  assert.equal(safeName('   '), '课件');
});

test('documents: prefers the URL the page already loaded, else the object store', () => {
  const loaded = 'https://p.ananas.chaoxing.com/star3/origin/abc.pdf?flag=1';
  assert.equal(downloadUrlFor({url: loaded, objectid: 'abc.pdf'}), loaded);
  // The bare object-store address answers with an HTML viewer page, so the variants that
  // name a real file are tried first and the bare form is dropped.
  assert.deepEqual(candidateUrls({objectid: 'abc123', type: 'pdf'}), [
    'https://p.ananas.chaoxing.com/star3/origin/abc123.pdf',
    'https://p.ananas.chaoxing.com/star3/origin/abc123?flag=1'
  ]);
  assert.equal(downloadUrlFor({objectid: 'abc123'}),
    'https://p.ananas.chaoxing.com/star3/origin/abc123?flag=1');
  // Never follow a third-party URL found in the page.
  assert.equal(downloadUrlFor({url: 'https://example.com/a.pdf'}), '');
  assert.equal(downloadUrlFor({name: 'no-id.pdf'}), '');
  assert.equal(downloadPath('265420739', '1.1 绪论.pdf'), '学习通课件/265420739/1.1 绪论.pdf');
  assert.equal(downloadPath('', '1.1 绪论.pdf'), '学习通课件/1.1 绪论.pdf');
});

test('documents: only a URL that names a real file is trusted blind', () => {
  assert.ok(isFileUrl('https://p.ananas.chaoxing.com/star3/origin/a.pdf'));
  assert.ok(isFileUrl('https://p.ananas.chaoxing.com/star3/origin/a.PPTX?x=1'));
  assert.ok(!isFileUrl('https://p.ananas.chaoxing.com/star3/origin/abc123'));
  assert.ok(!isFileUrl('https://mooc1.chaoxing.com/ananas/job/document?jobid=1'));
  assert.equal(withExtSuffix('https://p.ananas.chaoxing.com/star3/origin/abc123', 'pdf'),
    'https://p.ananas.chaoxing.com/star3/origin/abc123.pdf');
  assert.equal(withExtSuffix('https://p.ananas.chaoxing.com/star3/origin/abc123?flag=1', 'pdf'),
    'https://p.ananas.chaoxing.com/star3/origin/abc123.pdf?flag=1');
  assert.equal(withExtSuffix('https://p.ananas.chaoxing.com/star3/origin/a.pdf', 'ppt'),
    'https://p.ananas.chaoxing.com/star3/origin/a.pdf');
});

test('documents: a URL the page really requested outranks a guessed one', () => {
  const flagged = 'https://p.ananas.chaoxing.com/star3/origin/abc?flag=1&wsiphost=1';
  assert.equal(candidateUrls({objectid: 'abc', type: 'pdf', urls: [flagged]})[0], flagged);
  const file = 'https://p.ananas.chaoxing.com/star3/origin/abc.pdf';
  assert.equal(candidateUrls({
    objectid: 'abc',
    urls: ['https://p.ananas.chaoxing.com/star3/origin/abc', file]
  })[0], file);
  // A plain HTML page is never used as a file address.
  assert.equal(candidateUrls({urls: ['https://mooc1.chaoxing.com/ananas/job/download.html']}).length, 0);
});

test('documents: classifies the answer so a viewer page is never saved as a file', () => {
  assert.equal(mimeKind('text/html; charset=utf-8'), 'web');
  assert.equal(mimeKind('application/json'), 'web');
  assert.equal(mimeKind('text/javascript'), 'web');
  assert.equal(mimeKind('application/pdf'), 'file');
  assert.equal(mimeKind('application/vnd.openxmlformats-officedocument.presentationml.presentation'), 'file');
  assert.equal(mimeKind('application/octet-stream'), 'file');
  assert.equal(mimeKind('image/jpeg'), 'image');
  assert.equal(mimeKind(''), 'unknown');
  assert.equal(extFromMime('application/pdf'), 'pdf');
  assert.equal(extFromMime('application/vnd.ms-powerpoint'), 'ppt');
  assert.equal(nameFromDisposition('attachment; filename="1.1 绪论.ppt"'), '1.1 绪论.ppt');
  assert.equal(nameFromDisposition("attachment; filename*=UTF-8''%E7%BB%AA%E8%AE%BA.pdf"), '绪论.pdf');
  // The download name is only suffixed once the real type is known.
  assert.equal(fileBaseFor('1.1 绪论', {name: '绪论.ppt'}), '1.1 绪论');
  assert.equal(fileNameFor('1.1 绪论', {url: 'https://p.ananas.chaoxing.com/star3/origin/abc'}), '1.1 绪论');
  assert.equal(fileNameFor('1.1 绪论', {url: 'https://p.ananas.chaoxing.com/star3/origin/abc'}, 0, 1, 'pptx'), '1.1 绪论.pptx');
});

test('documents: a title taken from the attachment name is not repeated', () => {
  const att = {name: '卫生学(第9版)-绪论-防盼盼(1).ppt'};
  assert.equal(fileNameFor('卫生学(第9版)-绪论-防盼盼', att, 0, 1), '卫生学(第9版)-绪论-防盼盼.ppt');
  assert.equal(fileNameFor('卫生学(第9版)-绪论-防盼盼', att, 0, 2), '卫生学(第9版)-绪论-防盼盼_1.ppt');
  assert.equal(fileNameFor('卫生学(第9版)-绪论-防盼盼', att, 1, 2), '卫生学(第9版)-绪论-防盼盼_2.ppt');
});

test('documents: the viewer status endpoint is a manifest, never a download', () => {
  const status = 'https://mooc1.chaoxing.com/ananas/status/ds820e795e3f3c297480f0677e0d7?flag=normal&_dc=1794928957479';
  assert.ok(isStatusUrl(status));
  assert.deepEqual(urlsOf({url: status}), [status]);
  // The JSON endpoint must never be handed to the downloader; guessed variants are used instead.
  const cands = candidateUrls({objectid: 'ds820e795e3f3c297480f0677e0d7', type: 'ppt', urls: [status]});
  assert.ok(!cands.some(u => /ananas\/status/.test(u)));
  assert.equal(cands[0], 'https://p.ananas.chaoxing.com/star3/origin/ds820e795e3f3c297480f0677e0d7.ppt');
});

test('documents: merges the same file reported by several page sources', () => {
  const merged = dedupeAttachments([
    {objectid: 'abc', name: '', url: '', from: 'perf'},
    {objectid: 'abc', name: '绪论.ppt', url: '', size: 1024, from: 'setting'},
    {objectid: 'abc', name: '', url: 'https://p.ananas.chaoxing.com/star3/origin/abc', from: 'iframe'},
    {objectid: 'def', name: '讲义.pdf', from: 'setting'}
  ]);
  assert.equal(merged.length, 2);
  const first = merged.find(x => x.objectid === 'abc');
  assert.equal(first.name, '绪论.ppt');
  assert.equal(first.url, 'https://p.ananas.chaoxing.com/star3/origin/abc');
  assert.equal(first.size, 1024);
  assert.match(first.from, /perf/);
});

test('scanDocuments reads AttachmentSetting plus the viewer network history', () => {
  const previous = {
    document: globalThis.document, location: globalThis.location,
    window: globalThis.window, performance: globalThis.performance,
    top: globalThis.top, self: globalThis.self
  };
  globalThis.window = {
    AttachmentSetting: {
      attachments: [{objectid: 'abc', name: '1.1 绪论.ppt', type: 'ppt', size: 2048}]
    }
  };
  globalThis.document = {
    title: '绪论',
    body: {innerText: ''},
    documentElement: {innerHTML: ''},
    querySelectorAll: () => [],
    querySelector: () => null
  };
  globalThis.performance = {
    getEntriesByType: () => [{name: 'https://p.ananas.chaoxing.com/star3/origin/abc?flag=1'}]
  };
  globalThis.location = {
    href: 'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?courseid=265420739&clazzid=152556092&knowledgeid=1193824608&cpi=407437403'
  };
  globalThis.self = {};
  globalThis.top = globalThis.self;
  try {
    const result = loadInjected('scanDocuments')();
    assert.equal(result.courseId, '265420739');
    assert.equal(result.clazzId, '152556092');
    assert.equal(result.attachments.length, 1, 'the same object must not be reported twice');
    const att = result.attachments[0];
    assert.equal(att.name, '1.1 绪论.ppt', 'the name from AttachmentSetting wins over the bare URL');
    assert.equal(att.size, 2048);
    assert.match(att.url, /star3\/origin\/abc/);
    assert.equal(fileNameFor('1.1 绪论', att), '1.1 绪论.ppt');
  } finally {
    globalThis.document = previous.document;
    globalThis.location = previous.location;
    globalThis.window = previous.window;
    globalThis.performance = previous.performance;
    globalThis.top = previous.top;
    globalThis.self = previous.self;
  }
});
