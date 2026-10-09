(function () {
  "use strict";

  const bank = window.TAX_EXAM_BANK;
  const bookCatalog = window.TAX_EXAM_BOOK_CATALOG || {
    count: 0,
    subjects: [],
    materials: [],
  };
  const contentSummary = window.TAX_EXAM_CONTENT_SUMMARY || {
    documents: 0,
    bookMaterials: 0,
    structuredBooks: 0,
    knowledgeSections: 0,
    knowledgePoints: 0,
    formulas: 0,
    candidateQuestions: 0,
    supplementalQuestions: 0,
    completeAnswers: 0,
    suggestedAnswers: 0,
    missingAnswers: 0,
    ocrDocuments: 0,
    documentRoles: {},
    documentStatus: {},
  };
  const knowledgeBookIndex = window.TAX_EXAM_KNOWLEDGE_BOOK_INDEX || { books: [] };
  const knowledgeBookIndexById = new Map(
    (knowledgeBookIndex.books || []).map((book) => [book.id, book]),
  );
  const readerCache = new Map();
  const originalsCatalog = window.TAX_EXAM_ORIGINALS || { count: 0, entries: [] };
  const originalById = new Map(
    (originalsCatalog.entries || []).map((entry) => [entry.id, entry]),
  );
  const readerPrefs = {
    size: Number(localStorage.getItem("tax-exam-reader-size")) || 17,
    line: Number(localStorage.getItem("tax-exam-reader-line")) || 1.95,
    width: localStorage.getItem("tax-exam-reader-width") || "normal",
    theme: localStorage.getItem("tax-exam-reader-theme") || "paper",
  };
  const emptyMaterialBank = {
    questionCount: 0,
    sourceStats: [],
    errors: [],
    questions: [],
  };
  let materialBank = window.TAX_EXAM_MATERIAL_BANK || null;
  let documentAnalysis = window.TAX_EXAM_DOCUMENT_ANALYSIS || null;
  let supplementalBank = window.TAX_EXAM_SUPPLEMENTAL_BANK || null;
  let ocrCatalog = window.TAX_EXAM_OCR_CATALOG || null;
  let materialBankLoading = null;
  const mainContent = document.querySelector("#mainContent");
  const modalRoot = document.querySelector("#modalRoot");
  const toastStack = document.querySelector("#toastStack");
  const primaryNav = document.querySelector("#primaryNav");
  const sidebarSubjectList = document.querySelector("#sidebarSubjectList");
  const wrongNavCount = document.querySelector("#wrongNavCount");
  const favoriteNavCount = document.querySelector("#favoriteNavCount");
  const overallPercent = document.querySelector("#overallPercent");
  const storageLabel = document.querySelector("#storageLabel");
  const sidebarToggle = document.querySelector("#sidebarToggle");
  const sidebarScrim = document.querySelector("#sidebarScrim");
  const searchButton = document.querySelector("#searchButton");
  const themeButton = document.querySelector("#themeButton");
  const settingsButton = document.querySelector("#settingsButton");

  if (!bank || !Array.isArray(bank.questions) || !bank.questions.length) {
    mainContent.innerHTML = '<div class="empty-state"><div><h2>题库加载失败</h2><p>请确认 data.js 与本页面位于同一目录。</p></div></div>';
    return;
  }

  const STORAGE_KEY = window.__TAX_QUIZ_STORAGE_KEY || "tax-exam-quiz-state-v1";
  const CLOUD_MODE = Boolean(window.TAX_QUIZ_CLOUD_MODE);
  const SERVER_STATE_PATH = "/__state__.json";
  const STATE_VERSION = 1;
  const EXAM_DATE = new Date("2026-11-07T09:00:00+08:00");
  const TYPE_LABELS = {
    single: "单选题",
    multiple: "多选题",
    calculation: "计算题",
    comprehensive: "综合题",
    short: "简答题",
    unknown: "综合练习",
  };
  const REASON_LABELS = {
    concept: "概念不清",
    calculation: "计算失误",
    reading: "审题遗漏",
    memory: "记忆模糊",
    method: "方法不熟",
    other: "其他原因",
  };
  const SUBJECT_ICONS = {
    finance: "calculator",
    law: "scale",
    practice: "briefcase-business",
    tax2: "landmark",
    tax1: "badge-percent",
  };

  const subjectById = new Map(bank.subjects.map((subject) => [subject.id, subject]));
  const chapterById = new Map();
  const questionById = new Map();
  const questionsBySubject = new Map();
  const questionsByChapter = new Map();

  bank.subjects.forEach((subject) => {
    subject.chapters.forEach((chapter) => {
      chapter.subjectId = subject.id;
      chapter.subjectName = subject.name;
      chapterById.set(chapter.id, chapter);
      questionsByChapter.set(chapter.id, []);
    });
  });

  bank.questions.forEach((question) => {
    const subject = subjectById.get(question.subjectId);
    const chapter = chapterById.get(question.chapterId);
    question.subjectName = subject ? subject.name : question.subjectId;
    question.chapterName = chapter ? chapter.name : question.chapterId;
    questionById.set(question.id, question);
    if (!questionsBySubject.has(question.subjectId)) {
      questionsBySubject.set(question.subjectId, []);
    }
    questionsBySubject.get(question.subjectId).push(question);
    if (!questionsByChapter.has(question.chapterId)) {
      questionsByChapter.set(question.chapterId, []);
    }
    questionsByChapter.get(question.chapterId).push(question);
  });

  let bookBankStats = { questionCount: 0, bookCount: 0, duplicateCount: 0, subjects: [] };

  function registerConfirmedQuestions() {
    const unified = window.TAX_EXAM_UNIFIED_BANK;
    if (!unified || !Array.isArray(unified.questions) || !unified.questions.length) return;

    const bySubject = new Map();
    unified.questions.forEach((question) => {
      if (!question || !question.id || !question.subjectId) return;
      if (questionById.has(question.id)) return;
      if (!Array.isArray(question.options) || !question.options.length) return;
      const answer = Array.isArray(question.answer) ? question.answer : [];
      if (!answer.length && !question.answerText) return;
      const subject = subjectById.get(question.subjectId);
      if (!subject) return;
      if (!bySubject.has(question.subjectId)) bySubject.set(question.subjectId, []);
      bySubject.get(question.subjectId).push(question);
    });

    bookBankStats = { questionCount: 0, bookCount: 0, duplicateCount: unified.duplicateCount || 0, subjects: [] };

    bySubject.forEach((questions, subjectId) => {
      const subject = subjectById.get(subjectId);
      const books = new Map();
      questions.forEach((question) => {
        const title = question.bookTitle || question.materialName || "资料题目";
        if (!books.has(title)) books.set(title, []);
        books.get(title).push(question);
      });

      const rows = [];
      books.forEach((bookQuestions, title) => {
        let hash = 0;
        const seed = `${subjectId}|${title}`;
        for (let index = 0; index < seed.length; index += 1) {
          hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
        }
        const chapterId = `bank-book-${subjectId}-${hash.toString(36)}`;
        const chapter = {
          id: chapterId,
          name: title,
          order: rows.length + 1,
          subjectId,
          subjectName: subject.name,
          chapterCount: 0,
          questionCount: bookQuestions.length,
          isBook: true,
        };
        subject.chapters.push(chapter);
        chapterById.set(chapterId, chapter);
        questionsByChapter.set(chapterId, []);

        bookQuestions.forEach((question) => {
          const normalized = {
            ...question,
            chapterId,
            chapterName: title,
            subjectName: subject.name,
            source: "material",
            bookTitle: title,
            typeLabel: question.typeLabel || TYPE_LABELS[question.type] || "综合题",
          };
          questionById.set(question.id, normalized);
          bank.questions.push(normalized);
          questionsByChapter.get(chapterId).push(normalized);
          if (!questionsBySubject.has(subjectId)) questionsBySubject.set(subjectId, []);
          questionsBySubject.get(subjectId).push(normalized);
        });

        rows.push({
          id: chapterId,
          title,
          subjectId,
          subjectName: subject.name,
          materialName: bookQuestions[0]?.materialName || "",
          questionCount: bookQuestions.length,
        });
      });

      rows.sort((left, right) => right.questionCount - left.questionCount);
      subject.questionCount = (subject.questionCount || 0) + questions.length;
      subject.chapterCount = (subject.chapterCount || 0) + rows.length;
      bookBankStats.subjects.push({
        subjectId,
        subjectName: subject.name,
        questionCount: questions.length,
        chapters: rows,
      });
      bookBankStats.questionCount += questions.length;
      bookBankStats.bookCount += rows.length;
    });
  }

  registerConfirmedQuestions();

  const ui = {
    view: "dashboard",
    librarySubject: bank.subjects[0].id,
    librarySearch: "",
    librarySource: "all",
    ebookMaterial: "高频考点与重难点",
    ebookSubject: "all",
    ebookBookId: "",
    ebookSectionId: "",
    ebookPage: 0,
    ebookChapterId: "",
    ebookOpenChapters: {},
    originalSubject: "all",
    originalRole: "all",
    originalSearch: "",
    originalId: "",
    originalZoom: 100,
    originalVisible: false,
    studioSubject: "all",
    studioMaterial: "all",
    studioStatus: "all",
    studioSearch: "",
    documentSubject: "all",
    documentRole: "all",
    documentStatus: "all",
    documentSearch: "",
    wrongSearch: "",
    wrongSubject: "all",
    wrongChapter: "all",
    wrongType: "all",
    wrongSort: "recent",
    modal: null,
  };

  let state = loadState();
  let timerHandle = null;
  let timerDisplay = null;
  let modalTimerHandle = null;
  let serverPersistenceAvailable = false;
  let serverSaveTimer = null;

  function todayKey(date) {
    const value = date || new Date();
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function defaultState() {
    return {
      version: STATE_VERSION,
      bankVersion: bank.version,
      settings: {
        theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        autoNext: false,
      },
      records: {},
      daily: {},
      materialReview: {},
      agentMessages: [],
      activeSession: null,
      lastSummary: null,
      generation: 1,
      clearedAt: "",
      lastVisit: new Date().toISOString(),
    };
  }

  function loadState() {
    const fallback = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STATE_VERSION) return fallback;
      return {
        ...fallback,
        ...parsed,
        settings: { ...fallback.settings, ...(parsed.settings || {}) },
        records: parsed.records && typeof parsed.records === "object" ? parsed.records : {},
        daily: parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {},
      };
    } catch (error) {
      console.warn("无法读取本地进度", error);
      return fallback;
    }
  }

  function normalizeState(parsed) {
    const fallback = defaultState();
    if (!parsed || parsed.version !== STATE_VERSION) return null;
    return {
      ...fallback,
      ...parsed,
      settings: { ...fallback.settings, ...(parsed.settings || {}) },
      records: parsed.records && typeof parsed.records === "object" ? parsed.records : {},
      daily: parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {},
    };
  }

  function mergeStates(remoteState, localState) {
    if (!remoteState) return localState;
    if (!localState) return remoteState;

    const remoteGeneration = Number(remoteState.generation) || 1;
    const localGeneration = Number(localState.generation) || 1;
    if (remoteState.clearedAt && remoteGeneration > localGeneration) {
      return remoteState;
    }
    if (localState.clearedAt && localGeneration > remoteGeneration) {
      return localState;
    }

    const mergedRecords = { ...(remoteState.records || {}) };
    Object.entries(localState.records || {}).forEach(([questionId, localRecord]) => {
      const remoteRecord = mergedRecords[questionId];
      if (!remoteRecord) {
        mergedRecords[questionId] = localRecord;
        return;
      }
      const localTime = String(localRecord.lastAt || "");
      const remoteTime = String(remoteRecord.lastAt || "");
      if (
        localTime > remoteTime ||
        (localTime === remoteTime &&
          (Number(localRecord.attempts) || 0) > (Number(remoteRecord.attempts) || 0))
      ) {
        mergedRecords[questionId] = localRecord;
      }
    });

    const remoteHasDaily = Object.keys(remoteState.daily || {}).length > 0;
    const localHasDaily = Object.keys(localState.daily || {}).length > 0;
    const remoteSessionTime = Number(remoteState.activeSession?.startedAt) || 0;
    const localSessionTime = Number(localState.activeSession?.startedAt) || 0;
    const remoteSummaryTime = Date.parse(remoteState.lastSummary?.finishedAt || "") || 0;
    const localSummaryTime = Date.parse(localState.lastSummary?.finishedAt || "") || 0;

    return {
      ...remoteState,
      settings: { ...localState.settings, ...remoteState.settings },
      records: mergedRecords,
      daily: remoteHasDaily || !localHasDaily ? remoteState.daily || {} : localState.daily || {},
      activeSession:
        remoteSessionTime || !localSessionTime
          ? remoteState.activeSession
          : localState.activeSession,
      lastSummary:
        remoteSummaryTime >= localSummaryTime
          ? remoteState.lastSummary
          : localState.lastSummary,
      lastVisit:
        String(remoteState.lastVisit || "") >= String(localState.lastVisit || "")
          ? remoteState.lastVisit
          : localState.lastVisit,
      generation: Math.max(remoteGeneration, localGeneration),
      clearedAt:
        String(remoteState.clearedAt || "") >= String(localState.clearedAt || "")
          ? remoteState.clearedAt || ""
          : localState.clearedAt || "",
    };
  }

  async function bootstrapPersistence() {
    try {
      const response = await fetch(SERVER_STATE_PATH, { cache: "no-store" });
      if (!response.ok) throw new Error(`状态接口返回 ${response.status}`);
      const payload = await response.json();
      const remoteState = normalizeState(payload?.state);
      state = mergeStates(remoteState, state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      serverPersistenceAvailable = true;
      storageLabel.textContent = "固定本机进度文件";
      queueServerSave(true);
    } catch (error) {
      serverPersistenceAvailable = false;
      console.warn("服务端进度文件不可用，继续使用浏览器本地存储", error);
      storageLabel.textContent = "浏览器本地保存";
    }
    applyTheme();
    render();
  }

  function queueServerSave(immediate) {
    if (!serverPersistenceAvailable) return;
    window.clearTimeout(serverSaveTimer);
    serverSaveTimer = window.setTimeout(
      async () => {
        try {
          const response = await fetch(SERVER_STATE_PATH, {
            method: "PUT",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              app: "tax-exam-quiz",
              bankVersion: bank.version,
              savedAt: new Date().toISOString(),
              state,
            }),
          });
          if (!response.ok) throw new Error(`保存接口返回 ${response.status}`);
          storageLabel.textContent = "固定本机进度文件";
        } catch (error) {
          console.warn("服务端进度保存失败", error);
          storageLabel.textContent = "浏览器已保存，文件同步失败";
        }
      },
      immediate ? 0 : 300,
    );
  }

  function saveState() {
    state.lastVisit = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageLabel.textContent = serverPersistenceAvailable ? "已写入固定进度文件" : "进度已保存";
    } catch (error) {
      console.warn("无法保存本地进度", error);
      storageLabel.textContent = serverPersistenceAvailable ? "浏览器保存失败，正在同步文件" : "本地保存失败";
    }
    queueServerSave();
  }

  function recordFor(questionId, create) {
    if (!state.records[questionId] && create) {
      state.records[questionId] = {
        attempts: 0,
        correct: 0,
        wrongCount: 0,
        streak: 0,
        mastery: 0,
        favorite: false,
        note: "",
        reason: "",
        lastAnswer: [],
        lastCorrect: null,
        lastAt: "",
        firstWrongAt: "",
        lastWrongAt: "",
      };
    }
    return state.records[questionId] || null;
  }

  function answerKeysEqual(left, right) {
    const a = [...(left || [])].sort().join("");
    const b = [...(right || [])].sort().join("");
    return a === b;
  }

  function isMastered(record) {
    return Boolean(record && record.mastery >= 3);
  }

  function unansweredCountsAsWrong() {
    return true;
  }

  function updateRecordAfterAnswer(question, correct, selected, options) {
    const record = recordFor(question.id, true);
    const now = new Date();
    const minutes = Math.max(
      0.15,
      Math.min(15, (Date.now() - (state.activeSession?.lastActivityAt || Date.now())) / 60000),
    );

    record.attempts += 1;
    if (correct) record.correct += 1;
    record.streak = correct ? record.streak + 1 : 0;
    record.lastCorrect = correct;
    record.lastAnswer = Array.isArray(selected) ? selected : [];
    record.lastAt = now.toISOString();

    if (!correct) {
      record.wrongCount += 1;
      record.mastery = Math.max(0, Math.min(1, record.mastery));
      if (!record.firstWrongAt) record.firstWrongAt = now.toISOString();
      record.lastWrongAt = now.toISOString();
      record.nextReviewAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    } else if (record.wrongCount > 0) {
      record.mastery = Math.max(record.mastery, Math.min(3, record.streak));
      const intervals = [1, 3, 7, 14, 30];
      const days = intervals[Math.min(record.streak - 1, intervals.length - 1)] || 1;
      record.nextReviewAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    if (options && options.selfRating === "mastered") {
      record.mastery = Math.max(3, record.mastery);
      record.streak = Math.max(3, record.streak);
    } else if (options && options.selfRating === "vague") {
      record.mastery = Math.min(record.mastery, 1);
    } else if (options && options.selfRating === "unknown") {
      record.mastery = 0;
    }

    const daily = state.daily[todayKey()] || { answered: 0, correct: 0, minutes: 0 };
    daily.answered += 1;
    daily.correct += correct ? 1 : 0;
    daily.minutes = Math.round((daily.minutes + minutes) * 10) / 10;
    state.daily[todayKey()] = daily;
    if (state.activeSession) state.activeSession.lastActivityAt = Date.now();
  }

  function subjectQuestions(subjectId) {
    return questionsBySubject.get(subjectId) || [];
  }

  function chapterQuestions(chapterId) {
    return questionsByChapter.get(chapterId) || [];
  }

  function subjectStats(subjectId) {
    const questions = subjectQuestions(subjectId);
    let answered = 0;
    let correct = 0;
    let attempts = 0;
    let wrong = 0;
    let mastered = 0;

    questions.forEach((question) => {
      const record = state.records[question.id];
      if (!record || !record.attempts) return;
      answered += 1;
      attempts += record.attempts;
      correct += record.correct;
      if (record.wrongCount > 0 && !isMastered(record)) wrong += 1;
      if (isMastered(record)) mastered += 1;
    });

    return {
      total: questions.length,
      answered,
      attempts,
      correct,
      wrong,
      mastered,
      progress: questions.length ? answered / questions.length : 0,
      accuracy: attempts ? correct / attempts : 0,
    };
  }

  function chapterStats(chapterId) {
    const questions = chapterQuestions(chapterId);
    let answered = 0;
    let attempts = 0;
    let correct = 0;
    let wrong = 0;

    questions.forEach((question) => {
      const record = state.records[question.id];
      if (!record || !record.attempts) return;
      answered += 1;
      attempts += record.attempts;
      correct += record.correct;
      if (record.wrongCount > 0 && !isMastered(record)) wrong += 1;
    });

    return {
      total: questions.length,
      answered,
      attempts,
      correct,
      wrong,
      progress: questions.length ? answered / questions.length : 0,
      accuracy: attempts ? correct / attempts : 0,
    };
  }

  function overallStats() {
    let total = bank.questions.length;
    let answered = 0;
    let attempts = 0;
    let correct = 0;
    let wrong = 0;
    let favorites = 0;

    bank.questions.forEach((question) => {
      const record = state.records[question.id];
      if (!record) return;
      if (record.attempts) {
        answered += 1;
        attempts += record.attempts;
        correct += record.correct;
      }
      if (record.wrongCount > 0 && !isMastered(record)) wrong += 1;
      if (record.favorite) favorites += 1;
    });

    return {
      total,
      answered,
      attempts,
      correct,
      wrong,
      favorites,
      progress: total ? answered / total : 0,
      accuracy: attempts ? correct / attempts : 0,
    };
  }

  function wrongQuestionsForFilters(filters) {
    const active = filters || {};
    return bank.questions
      .map((question) => ({ question, record: state.records[question.id] }))
      .filter(({ question, record }) => {
        if (!record || !record.wrongCount || isMastered(record)) return false;
        if (active.subject && active.subject !== "all" && question.subjectId !== active.subject) return false;
        if (active.chapter && active.chapter !== "all" && question.chapterId !== active.chapter) return false;
        if (active.type && active.type !== "all" && question.type !== active.type) return false;
        if (active.query) {
          const haystack = `${question.prompt} ${question.options.map((item) => item.text).join(" ")}`.toLowerCase();
          if (!haystack.includes(active.query.toLowerCase())) return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (active.sort === "wrongCount") {
          return (right.record.wrongCount || 0) - (left.record.wrongCount || 0);
        }
        if (active.sort === "chapter") {
          return left.question.chapterId.localeCompare(right.question.chapterId);
        }
        return String(right.record.lastWrongAt || "").localeCompare(String(left.record.lastWrongAt || ""));
      });
  }

  function favoriteQuestions() {
    return bank.questions
      .filter((question) => state.records[question.id]?.favorite)
      .sort((left, right) => String(state.records[right.id]?.lastAt || "").localeCompare(String(state.records[left.id]?.lastAt || "")));
  }

  function htmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function nl2br(value) {
    return htmlEscape(value).replace(/\n/g, "<br>");
  }

  function icon(name) {
    return `<i data-lucide="${htmlEscape(name)}"></i>`;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "--";
    return `${Math.round(value * 100)}%`;
  }

  function formatDateTime(value) {
    if (!value) return "尚未作答";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "尚未作答";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    return hours
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function daysUntilExam() {
    const diff = EXAM_DATE.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }

  function examPhaseInfo() {
    const days = daysUntilExam();
    if (days === 0) {
      return { days, stage: "考试进行时", tone: "danger", note: "保持状态，按考场节奏答题" };
    }
    if (days <= 21) {
      return { days, stage: "冲刺阶段", tone: "danger", note: "以真题、错题和限时训练为主" };
    }
    if (days <= 60) {
      return { days, stage: "强化阶段", tone: "accent", note: "主攻薄弱章节和高频考点" };
    }
    if (days <= 120) {
      return { days, stage: "系统复习", tone: "primary", note: "章节练习与知识书结合推进" };
    }
    return { days, stage: "基础夯实", tone: "success", note: "先把五科框架和教材变化过一遍" };
  }

  function focusChapters(limit) {
    const rows = [];
    [...chapterById.values()].forEach((chapter) => {
      const stats = chapterStats(chapter.id);
      if (!stats.attempts && !stats.wrong) return;
      const accuracy = stats.attempts ? stats.accuracy : 0;
      const coverage = stats.progress;
      const score =
        stats.wrong * 3 +
        (1 - accuracy) * 120 +
        (1 - coverage) * 60 +
        Math.min(stats.answered, 30) * 0.4;
      rows.push({ chapter, stats, score, accuracy, coverage });
    });
    rows.sort((left, right) => right.score - left.score);
    return rows.slice(0, limit || 6);
  }

  function suggestedFocusChapters(limit) {
    const weak = focusChapters(limit);
    if (weak.length) return weak;
    return [...chapterById.values()]
      .map((chapter) => ({ chapter, stats: chapterStats(chapter.id), score: 0 }))
      .slice(0, limit || 6);
  }

  function greetingText() {
    const hour = new Date().getHours();
    if (hour < 6) return "夜深了";
    if (hour < 11) return "早上好";
    if (hour < 14) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function focusToneClass(value) {
    if (value >= 0.75) return "success";
    if (value >= 0.55) return "accent";
    return "danger";
  }

  function shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function setActiveNavigation() {
    primaryNav.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === ui.view);
    });
    sidebarSubjectList.querySelectorAll(".sidebar-subject").forEach((button) => {
      button.classList.toggle(
        "active",
        ui.view === "library" && button.dataset.subjectId === ui.librarySubject,
      );
    });
  }

  function renderSidebar() {
    sidebarSubjectList.replaceChildren();
    bank.subjects.forEach((subject) => {
      const stats = subjectStats(subject.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sidebar-subject";
      button.dataset.action = "open-subject";
      button.dataset.subjectId = subject.id;
      button.innerHTML = `
        <span>
          <strong>${htmlEscape(subject.shortName)}</strong>
          <small>${stats.answered}/${stats.total} 题 · ${formatPercent(stats.accuracy)}</small>
        </span>
        <span class="mini-progress"><span style="width:${Math.round(stats.progress * 100)}%"></span></span>
      `;
      sidebarSubjectList.append(button);
    });
    const overall = overallStats();
    wrongNavCount.textContent = String(overall.wrong);
    favoriteNavCount.textContent = String(overall.favorites);
    overallPercent.textContent = formatPercent(overall.progress);
    setActiveNavigation();
  }

  function navigate(view, options) {
    ui.view = view;
    if (options?.subjectId) ui.librarySubject = options.subjectId;
    closeModal(false);
    document.body.classList.remove("sidebar-open");
    render();
    mainContent.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    stopTimer();
    renderSidebar();
    if (ui.view === "dashboard") renderDashboard();
    else if (ui.view === "library") renderLibrary();
    else if (ui.view === "recite") renderEbook();
    else if (ui.view === "originals") renderOriginals();
    else if (ui.view === "studio") renderContentStudio();
    else if (ui.view === "agent") renderAgent();
    else if (ui.view === "wrong") renderWrongBook(false);
    else if (ui.view === "favorites") renderWrongBook(true);
    else if (ui.view === "stats") renderStats();
    else if (ui.view === "practice") renderPractice();
    else if (ui.view === "summary") renderSummary();
    else renderDashboard();
    refreshIcons();
    startTimerIfNeeded();
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({
        attrs: {
          "stroke-width": "1.9",
        },
      });
    }
  }

  function pageHead(title, subtitle, actions) {
    return `
      <div class="page-head">
        <div class="page-head-copy">
          <h1>${htmlEscape(title)}</h1>
          <p>${htmlEscape(subtitle)}</p>
        </div>
        <div class="page-actions">${actions || ""}</div>
      </div>
    `;
  }

  function buildAgentContext() {
    const overall = overallStats();
    const subjectStatsRows = bank.subjects.map((subject) => {
      const stats = subjectStats(subject.id);
      return {
        subject: subject.name,
        progress: Math.round(stats.progress * 100),
        accuracy: stats.attempts ? Math.round(stats.accuracy * 100) : 0,
        answered: stats.answered,
        total: stats.total,
        wrong: stats.wrong,
      };
    });
    const chapterRows = [...chapterById.values()]
      .map((chapter) => ({ chapter, stats: chapterStats(chapter.id) }))
      .filter((item) => item.stats.attempts > 0)
      .sort((left, right) => left.stats.accuracy - right.stats.accuracy)
      .slice(0, 12)
      .map(({ chapter, stats }) => ({
        chapter: chapter.name,
        subject: chapter.subjectName,
        accuracy: Math.round(stats.accuracy * 100),
        answered: stats.answered,
        wrong: stats.wrong,
      }));
    const recentWrong = wrongQuestionsForFilters({ sort: "recent" })
      .slice(0, 20)
      .map(({ question, record }) => ({
        id: question.id,
        subject: question.subjectName,
        chapter: question.chapterName,
        prompt: question.prompt.slice(0, 260),
        options: question.options,
        answer: question.answer,
        explanation: question.explanation?.slice(0, 500) || "",
        wrongCount: record.wrongCount,
        avgSeconds: Math.round(record.averageAnswerSeconds || 0),
      }));
    const today = state.daily[todayKey()] || { answered: 0, correct: 0, minutes: 0 };
    return {
      generatedAt: new Date().toISOString(),
      bankVersion: bank.version,
      overall: {
        totalQuestions: overall.total,
        answeredQuestions: overall.answered,
        attempts: overall.attempts,
        accuracy: overall.attempts ? Math.round(overall.accuracy * 100) : 0,
        wrong: overall.wrong,
        favorites: overall.favorites,
        progress: Math.round(overall.progress * 100),
      },
      today,
      subjects: subjectStatsRows,
      weakChapters: chapterRows,
      recentWrong,
      activeSession: state.activeSession
        ? {
            scope: sessionTitle(state.activeSession),
            mode: state.activeSession.mode,
            index: state.activeSession.index + 1,
            total: state.activeSession.questionIds.length,
          }
        : null,
      library: {
        bookCount: bookCatalog.count || 0,
        ocrDocumentCount: ocrCatalog?.documentCount || 0,
        ocrTextCharacters:
          ocrCatalog?.documents?.reduce(
            (total, record) => total + (record.ocrTextLength || 0),
            0,
          ) || 0,
        materialCounts: bookCatalog.materials?.reduce((counts, item) => {
          counts[item.materialName] = (counts[item.materialName] || 0) + 1;
          return counts;
        }, {}) || {},
      },
      candidateContent: materialBank
        ? {
            questionCount: materialBank.questionCount,
            sourceCount: materialBank.sourceFileCount,
            duplicateCount: materialBank.duplicateCount,
            supplementalQuestionCount: supplementalBank?.questionCount || 0,
            supplementalCompleteCount: supplementalBank?.completeAnswerCount || 0,
            supplementalSuggestedCount: supplementalBank?.suggestedAnswerCount || 0,
            supplementalMissingCount: supplementalBank?.missingAnswerCount || 0,
          }
        : {
            questionCount: 0,
            sourceCount: 0,
            duplicateCount: 0,
            supplementalQuestionCount: supplementalBank?.questionCount || 0,
            supplementalCompleteCount: supplementalBank?.completeAnswerCount || 0,
            supplementalSuggestedCount: supplementalBank?.suggestedAnswerCount || 0,
            supplementalMissingCount: supplementalBank?.missingAnswerCount || 0,
          },
    };
  }

  function renderAgentMessage(message) {
    const role = message.role === "assistant" ? "assistant" : "user";
    return `
      <div class="surface surface-pad" style="margin-bottom:10px;border-left:4px solid ${role === "assistant" ? "var(--primary)" : "var(--accent)"}">
        <div class="filter-bar" style="margin:0 0 8px">
          <span class="status-badge ${role === "assistant" ? "success" : ""}">${role === "assistant" ? "专业 Agent" : "你"}</span>
          <span class="text-muted" style="font-size:11px">${htmlEscape(formatDateTime(message.timestamp))}</span>
        </div>
        <div style="white-space:pre-wrap;line-height:1.75">${nl2br(message.content)}</div>
      </div>
    `;
  }

  function renderAgent() {
    const messages = state.agentMessages || [];
    mainContent.innerHTML = `
      <div class="page">
        ${pageHead("专业 Agent", "税务师全生命周期学习教练，结合你的进度、错题、时间和资料给出诊断与行动方案", `
          <button class="button" type="button" data-action="clear-agent-chat">${icon("trash-2")}清空对话</button>
        `)}
        <div class="overview-split">
          <div>
            <div class="surface surface-pad" style="margin-bottom:14px">
              <div class="section-head">
                <div>
                  <h2>对话</h2>
                  <p>Agent 会读取当前学习数据，但不会上传账号和密码。</p>
                </div>
              </div>
              <div id="agentMessages">
                ${
                  messages.length
                    ? messages.map(renderAgentMessage).join("")
                    : `
                      <div class="empty-state">
                        <div>
                          <span class="empty-state-icon">${icon("bot")}</span>
                          <h2>开始你的全生命周期学习诊断</h2>
                          <p>可以问它如何安排今天、薄弱科目怎么补、考前如何冲刺，或让它解释最近一道错题。</p>
                        </div>
                      </div>
                    `
                }
              </div>
              <div class="form-field" style="margin-top:14px">
                <label for="agentInput">向专业 Agent 提问</label>
                <textarea id="agentInput" class="field" rows="4" placeholder="例如：我只有30天，税一增值税和税二企业所得税最差，帮我安排一个计划。"></textarea>
              </div>
              <div class="filter-bar" style="margin-top:10px">
                <button class="button primary" type="button" data-action="agent-send">${icon("send")}发送</button>
                <span class="text-muted" style="font-size:11px">回答会保存到学习记录，可跨设备同步。</span>
              </div>
            </div>
          </div>
          <div>
            <div class="surface surface-pad">
              <div class="section-head">
                <div>
                  <h2>快速任务</h2>
                  <p>按税务师备考阶段直接发起</p>
                </div>
              </div>
              <div class="list-stack">
                ${[
                  "诊断我现在的整体掌握程度，给出最优先的三个动作。",
                  "根据当前进度生成未来7天学习计划。",
                  "分析我的薄弱章节，安排错题重练顺序。",
                  "我准备做模拟考试，帮我制定时间分配和复盘流程。",
                  "距离考试时间不多时，我应该怎样安排冲刺？",
                  "解释我最近一道错题，并给出记忆方法和复习时间。",
                ]
                  .map(
                    (prompt) => `
                      <button class="compact-row" type="button" data-action="agent-suggestion" data-prompt="${htmlEscape(prompt)}">
                        <span class="type-badge">${icon("sparkles")}</span>
                        <span class="row-copy"><strong>${htmlEscape(prompt)}</strong></span>
                        ${icon("chevron-right")}
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    refreshIcons();
    const messagesBox = document.querySelector("#agentMessages");
    if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  async function sendAgentMessage(text) {
    const content = String(text || "").trim();
    if (!content) return;
    if (!Array.isArray(state.agentMessages)) state.agentMessages = [];
    state.agentMessages.push({
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    });
    state.agentMessages = state.agentMessages.slice(-30);
    saveState();
    renderAgent();
    const loadingId = `agent-loading-${Date.now()}`;
    const messagesBox = document.querySelector("#agentMessages");
    if (messagesBox) {
      messagesBox.insertAdjacentHTML(
        "beforeend",
        `<div id="${loadingId}" class="surface surface-pad"><strong>专业 Agent 正在分析...</strong></div>`,
      );
    }
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          context: JSON.stringify(buildAgentContext()),
          messages: state.agentMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || `Agent 接口返回 ${response.status}`);
      }
      state.agentMessages.push({
        role: "assistant",
        content: payload.answer || "Agent 没有返回内容。",
        timestamp: new Date().toISOString(),
      });
      state.agentMessages = state.agentMessages.slice(-30);
      saveState();
      renderAgent();
    } catch (error) {
      document.querySelector(`#${loadingId}`)?.remove();
      toast("专业 Agent 暂时不可用", error.message, "error");
    }
  }

  function renderDashboard() {
    const overall = overallStats();
    const today = state.daily[todayKey()] || { answered: 0, correct: 0, minutes: 0 };
    const active = state.activeSession;
    const recentWrong = wrongQuestionsForFilters({ sort: "recent" }).slice(0, 5);
    const phase = examPhaseInfo();
    const focusRows = suggestedFocusChapters(5);
    const dateText = new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(new Date());
    const answeredToday = overall.answered > 0;

    const heroMarkup = active
      ? `
        <div class="hero-copy">
          <span class="eyebrow">继续上次进度</span>
          <h2>${htmlEscape(sessionTitle(active))}</h2>
          <p>已答 ${Object.keys(active.answers || {}).length + Object.keys(active.examSelections || {}).length} / ${active.questionIds.length} 题 · ${active.mode === "exam" ? "模拟考试" : "章节练习"}</p>
        </div>
        <div class="continue-actions">
          <button class="button primary" type="button" data-action="continue-session">${icon("play")}继续做题</button>
          <button class="button ghost" type="button" data-action="discard-session">${icon("x")}放弃本次</button>
        </div>
      `
      : `
        <div class="hero-copy">
          <span class="eyebrow">${htmlEscape(phase.stage)} · 今日学习</span>
          <h2>${answeredToday ? "保持节奏，继续推进薄弱章节" : "从第一套章节题开始建立手感"}</h2>
          <p>${answeredToday ? `已覆盖 ${overall.answered} / ${overall.total} 题，累计正确率 ${formatPercent(overall.accuracy)}。` : "题库已按 2026 年五科章节整理完成，先从任一薄弱章节切入。"}</p>
        </div>
        <div class="continue-actions">
          <button class="button primary" type="button" data-action="recommended-start">${icon("play")}开始推荐练习</button>
          <button class="button ghost" type="button" data-view="library">${icon("library-big")}浏览章节</button>
        </div>
      `;

    const subjectCards = bank.subjects
      .map((subject) => {
        const stats = subjectStats(subject.id);
        const tone = focusToneClass(stats.attempts ? stats.accuracy : 0);
        return `
          <article class="subject-card" data-action="open-subject" data-subject-id="${subject.id}" role="button" tabindex="0">
            <div class="subject-card-top">
              <span class="subject-icon ${subject.id}">${icon(SUBJECT_ICONS[subject.id] || "book-open")}</span>
              <span class="status-badge ${tone}">${stats.attempts ? formatPercent(stats.accuracy) : "未开始"}</span>
            </div>
            <h3>${htmlEscape(subject.name)}</h3>
            <p>${subject.chapterCount} 章 · ${subject.questionCount} 题</p>
            <div class="progress-line"><span style="width:${Math.round(stats.progress * 100)}%"></span></div>
            <div class="subject-card-footer">
              <span>${formatPercent(stats.progress)} 完成${stats.wrong ? ` · 错题 ${stats.wrong}` : ""}</span>
              <span class="subject-enter">${icon("arrow-right")}</span>
            </div>
          </article>
        `;
      })
      .join("");

    const focusMarkup = focusRows.length
      ? focusRows
          .map(({ chapter, stats, accuracy }) => `
            <button class="focus-row" type="button" data-action="open-start" data-chapter-id="${chapter.id}">
              <span class="chapter-number">${String(chapter.order).padStart(2, "0")}</span>
              <span class="focus-copy">
                <strong>${htmlEscape(chapter.name)}</strong>
                <span>${htmlEscape(chapter.subjectName)} · 已答 ${stats.answered}/${stats.total} · 正确率 ${stats.attempts ? formatPercent(accuracy) : "--"}</span>
              </span>
              <span class="status-badge ${focusToneClass(accuracy)}">${stats.wrong ? `错题 ${stats.wrong}` : "待强化"}</span>
              ${icon("play")}
            </button>
          `)
          .join("")
      : `
        <div class="empty-state compact">
          <div>
            <span class="empty-state-icon">${icon("compass")}</span>
            <h2>还没有练习记录</h2>
            <p>完成第一组题后，这里会给出优先复习顺序。</p>
          </div>
        </div>
      `;

    const wrongRows = recentWrong.length
      ? recentWrong
          .map(
            ({ question, record }) => `
              <button class="compact-row" type="button" data-action="open-question" data-question-id="${question.id}">
                <span class="type-badge ${question.type}">${htmlEscape(TYPE_LABELS[question.type] || question.typeLabel)}</span>
                <span class="row-copy">
                  <strong>${htmlEscape(question.prompt.slice(0, 64))}</strong>
                  <span>${htmlEscape(question.subjectName)} · ${htmlEscape(question.chapterName)}</span>
                </span>
                <span class="status-badge wrong">错 ${record.wrongCount} 次</span>
              </button>
            `,
          )
          .join("")
      : `
        <div class="empty-state compact">
          <div>
            <span class="empty-state-icon">${icon("shield-check")}</span>
            <h2>错题本还是空的</h2>
            <p>做题后错误会自动归档，可按章节导出 Word。</p>
          </div>
        </div>
      `;

    mainContent.innerHTML = `
      <div class="page command-center">
        <header class="command-head">
          <div class="command-greeting">
            <span class="command-date">${htmlEscape(dateText)}</span>
            <h1>${greetingText()}，今天继续推进</h1>
            <p>五科题库共 ${bank.questions.length} 题 · 其中资料题库 ${bookBankStats.questionCount} 题 / ${bookBankStats.bookCount} 本${CLOUD_MODE ? " · 云端进度已开启" : ""}</p>
          </div>
          <div class="command-actions">
            <span class="exam-chip ${phase.tone}">
              <span>距 2026 考试</span>
              <strong>${phase.days}</strong>
              <span>天</span>
            </span>
            <button class="button" type="button" data-action="open-search">${icon("search")}搜题</button>
            <button class="button primary" type="button" data-action="recommended-start">${icon("play")}快速开始</button>
          </div>
        </header>

        <section class="hero-panel">
          <div class="hero-main">${heroMarkup}</div>
          <div class="hero-aside">
            <span class="eyebrow">当前阶段</span>
            <strong>${htmlEscape(phase.stage)}</strong>
            <p>${htmlEscape(phase.note)}</p>
            <div class="hero-meter">
              <span class="hero-meter-track"><span style="width:${Math.round(overall.progress * 100)}%"></span></span>
              <small>题库完成度 ${formatPercent(overall.progress)}</small>
            </div>
          </div>
        </section>

        <section class="metric-strip">
          <div class="metric-tile">
            <span class="metric-label">${icon("pencil-line")}今日已答</span>
            <strong>${today.answered}</strong>
            <small>累计 ${overall.attempts} 次作答</small>
          </div>
          <div class="metric-tile">
            <span class="metric-label">${icon("target")}今日正确率</span>
            <strong>${today.answered ? formatPercent(today.correct / today.answered) : "--"}</strong>
            <small>${today.minutes ? `约 ${today.minutes.toFixed(1)} 分钟` : "开始第一题后计时"}</small>
          </div>
          <div class="metric-tile">
            <span class="metric-label">${icon("layers")}题库完成度</span>
            <strong>${formatPercent(overall.progress)}</strong>
            <small>${overall.answered} / ${overall.total} 题</small>
          </div>
          <div class="metric-tile">
            <span class="metric-label">${icon("notebook-tabs")}待复习错题</span>
            <strong>${overall.wrong}</strong>
            <small>收藏 ${overall.favorites} 题</small>
          </div>
        </section>

        <section class="quick-actions">
          <button class="quick-card" type="button" data-action="recommended-start">
            <span class="quick-icon primary">${icon("sparkles")}</span>
            <span class="quick-copy"><strong>智能推荐练习</strong><span>按掌握度自动组题</span></span>
            ${icon("chevron-right")}
          </button>
          <button class="quick-card" type="button" data-action="review-wrong">
            <span class="quick-icon danger">${icon("notebook-tabs")}</span>
            <span class="quick-copy"><strong>错题重练</strong><span>${overall.wrong} 道待复习</span></span>
            ${icon("chevron-right")}
          </button>
          <button class="quick-card" type="button" data-action="open-exam">
            <span class="quick-icon accent">${icon("timer-reset")}</span>
            <span class="quick-copy"><strong>限时模拟</strong><span>按考试节奏演练</span></span>
            ${icon("chevron-right")}
          </button>
          <button class="quick-card" type="button" data-action="agent-ask" data-prompt="结合我目前的进度、正确率和答题时间，诊断我现在的掌握程度，并给出未来7天的学习计划。">
            <span class="quick-icon violet">${icon("bot")}</span>
            <span class="quick-copy"><strong>AI 学习诊断</strong><span>生成下一步行动方案</span></span>
            ${icon("chevron-right")}
          </button>
        </section>

        <section class="section command-split">
          <div class="command-column">
            <div class="section-head">
              <div>
                <h2>优先复习</h2>
                <p>按错题、正确率和覆盖度排序</p>
              </div>
              <button class="button small" type="button" data-view="stats">查看统计</button>
            </div>
            <div class="focus-list">${focusMarkup}</div>

            <div class="section-head spaced">
              <div>
                <h2>最近错题</h2>
                <p>按最近错误时间排序</p>
              </div>
              <button class="button small" type="button" data-view="wrong">全部错题</button>
            </div>
            <div class="list-stack">${wrongRows}</div>
          </div>

          <aside class="command-aside">
            <div class="surface surface-pad agent-quick">
              <div class="section-head">
                <div>
                  <h2>专业 Agent</h2>
                  <p>已接入你的真实学习数据</p>
                </div>
                <button class="button small ghost" type="button" data-view="agent">打开</button>
              </div>
              <div class="agent-command-list">
                ${[
                  "诊断我现在的整体掌握程度，给出最优先的三个动作。",
                  "根据当前进度生成未来7天学习计划。",
                  "分析我的薄弱章节，安排错题重练顺序。",
                  "我准备做模拟考试，帮我制定时间分配和复盘流程。",
                ]
                  .map(
                    (prompt) => `
                      <button class="agent-command" type="button" data-action="agent-ask" data-prompt="${htmlEscape(prompt)}">
                        <span>${icon("message-square")}</span>
                        <strong>${htmlEscape(prompt)}</strong>
                        ${icon("arrow-up-right")}
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </div>

            <div class="surface surface-pad shelf-panel">
              <div class="section-head">
                <div>
                  <h2>题目来源</h2>
                  <p>共 ${bookBankStats.bookCount} 本资料 · ${bookBankStats.questionCount} 道确认题</p>
                </div>
                <button class="button small" type="button" data-view="library">章节题库</button>
              </div>
              <div class="shelf-list">
                ${bookBankStats.subjects
                  .map(
                    (row) => `
                      <div class="shelf-row">
                        <span class="subject-icon ${row.subjectId}">${icon(SUBJECT_ICONS[row.subjectId] || "book-open")}</span>
                        <span class="shelf-copy">
                          <strong>${htmlEscape(row.subjectName)}</strong>
                          <span>${row.chapters.length} 本资料 · ${row.questionCount} 题</span>
                        </span>
                        <button class="button small" type="button" data-action="switch-library-source-subject" data-subject-id="${row.subjectId}">查看</button>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </div>

            <div class="surface surface-pad vitals-panel">
              <div class="section-head">
                <div>
                  <h2>题库健康度</h2>
                  <p>确认题与去重情况</p>
                </div>
                <button class="button small ghost" type="button" data-view="studio">编辑</button>
              </div>
              <div class="vitals-grid">
                <div><strong>${bookBankStats.questionCount.toLocaleString("zh-CN")}</strong><span>确认题</span></div>
                <div><strong>${bookBankStats.bookCount}</strong><span>资料书</span></div>
                <div><strong>${bookBankStats.duplicateCount}</strong><span>已去重</span></div>
                <div><strong>${contentSummary.suggestedAnswers}</strong><span>待人工复核</span></div>
              </div>
              <div class="role-tags">
                ${bookBankStats.subjects
                  .map(
                    (row) =>
                      `<span>${htmlEscape(row.subjectName)} ${row.questionCount}</span>`,
                  )
                  .join("")}
                <span>待人工复核 ${contentSummary.suggestedAnswers}</span>
              </div>
            </div>
          </aside>
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <h2>五科进度</h2>
              <p>按章节统计完成度和练习正确率</p>
            </div>
            <button class="button small" type="button" data-view="library">进入章节题库</button>
          </div>
          <div class="subject-grid">${subjectCards}</div>
        </section>
      </div>
    `;
  }

  function renderLibrary() {
    const subject = subjectById.get(ui.librarySubject) || bank.subjects[0];
    const query = ui.librarySearch.trim().toLowerCase();
    const sourceFilter = ui.librarySource || "all";
    const allChapters = subject.chapters.filter((chapter) => {
      if (!query) return true;
      return `${chapter.name} ${chapter.group}`.toLowerCase().includes(query);
    });
    const bookChapters = allChapters.filter((chapter) => chapter.isBook);
    const coreChapters = allChapters.filter((chapter) => !chapter.isBook);
    let chapters;
    if (sourceFilter === "core") chapters = coreChapters;
    else if (sourceFilter === "books") chapters = bookChapters;
    else if (sourceFilter !== "all") chapters = allChapters.filter((chapter) => chapter.id === sourceFilter);
    else chapters = allChapters;

    const subjectTabs = bank.subjects
      .map(
        (item) => `
          <button type="button" class="${item.id === subject.id ? "active" : ""}" data-action="switch-library-subject" data-subject-id="${item.id}">
            ${htmlEscape(item.shortName)} · ${item.questionCount}
          </button>
        `,
      )
      .join("");

    const bookOptions = bookChapters
      .slice()
      .sort((left, right) => right.questionCount - left.questionCount)
      .map(
        (chapter) =>
          `<option value="${chapter.id}" ${sourceFilter === chapter.id ? "selected" : ""}>${htmlEscape(chapter.name)}（${chapter.questionCount}）</option>`,
      )
      .join("");

    const sourceFilterBar = `
      <div class="source-filter">
        <span class="source-filter-label">${icon("layers")}题目来源</span>
        <div class="segmented">
          <button type="button" class="${sourceFilter === "all" ? "active" : ""}" data-action="switch-library-source" data-source="all">全部</button>
          <button type="button" class="${sourceFilter === "core" ? "active" : ""}" data-action="switch-library-source" data-source="core">教材章节</button>
          <button type="button" class="${sourceFilter === "books" || bookOptions.includes(`value="${sourceFilter}"`) ? "active" : ""}" data-action="switch-library-source" data-source="books">资料书 ${bookChapters.length}</button>
        </div>
        <label class="field book-select">
          ${icon("book-marked")}
          <select id="libraryBookSelect">
            <option value="">按书名选择…</option>
            ${bookOptions}
          </select>
        </label>
      </div>
    `;

    const chapterRows = chapters.length
      ? chapters
          .map((chapter) => {
            const stats = chapterStats(chapter.id);
            const typeText = Object.entries(chapter.typeCounts || {})
              .map(([type, count]) => `${TYPE_LABELS[type] || type} ${count}`)
              .join(" · ");
          const chapterQuestions = chapter.isBook ? questionsByChapter.get(chapter.id) || [] : [];
          const sourceTitles = chapter.isBook
            ? [...new Set(chapterQuestions.map((question) => question.sourceTitle).filter(Boolean))]
            : [];
          const sourceHint = sourceTitles.length
            ? `合并 ${sourceTitles.length} 份资料：${sourceTitles.slice(0, 2).join("、")}${sourceTitles.length > 2 ? " 等" : ""}`
            : "";
            return `
              <article class="chapter-card ${chapter.isBook ? "book-chapter" : ""}">
                <span class="chapter-number">${chapter.isBook ? icon("book-marked") : String(chapter.order).padStart(2, "0")}</span>
                <div class="chapter-copy">
                  <h3>${htmlEscape(chapter.name)}</h3>
                  <div class="chapter-meta">
                    <span>${chapter.questionCount} 题</span>
                    ${chapter.isBook ? `<span class="book-source-tag">资料题</span>` : chapter.group ? `<span>${htmlEscape(chapter.group)}</span>` : ""}
                    <span>${htmlEscape(typeText)}</span>
                  </div>
                  ${sourceHint ? `<div class="chapter-source-hint">${htmlEscape(sourceHint)}</div>` : ""}
                </div>
                <div class="chapter-progress">
                  <div class="chapter-progress-head">
                    <span>完成 ${stats.answered}/${stats.total}</span>
                    <span>${stats.attempts ? `正确率 ${formatPercent(stats.accuracy)}` : "未开始"}</span>
                  </div>
                  <div class="progress-line"><span style="width:${Math.round(stats.progress * 100)}%"></span></div>
                </div>
                <div class="chapter-actions">
                  <button class="button small ${stats.wrong ? "" : "ghost"}" type="button" data-action="export-chapter-wrong" data-chapter-id="${chapter.id}" ${stats.wrong ? "" : "disabled"}>${icon("file-down")}错题</button>
                  <button class="button small primary" type="button" data-action="open-start" data-chapter-id="${chapter.id}">${icon("play")}练习</button>
                </div>
              </article>
            `;
          })
          .join("")
      : `
        <div class="empty-state">
          <div>
            <span class="empty-state-icon">${icon("search-x")}</span>
            <h2>没有匹配的章节</h2>
            <p>换一个关键词再试。</p>
          </div>
        </div>
      `;

    mainContent.innerHTML = `
      <div class="page">
        ${pageHead("章节题库", `${subject.name} · ${subject.chapterCount} 章 · ${subject.questionCount} 题（含资料题 ${bookChapters.reduce((sum, chapter) => sum + chapter.questionCount, 0)}）`, `
          <button class="button" type="button" data-action="export-subject-wrong" data-subject-id="${subject.id}">${icon("file-down")}导出本册错题</button>
          <button class="button primary" type="button" data-action="open-start-subject" data-subject-id="${subject.id}">${icon("shuffle")}随机练习</button>
        `)}
        <div class="filter-bar">
          <div class="segmented">${subjectTabs}</div>
          <label class="field search-field">
            ${icon("search")}
            <input id="librarySearch" type="search" value="${htmlEscape(ui.librarySearch)}" placeholder="搜索章节名称" />
          </label>
        </div>
        ${sourceFilterBar}
        <div class="chapter-list">${chapterRows}</div>
      </div>
    `;

    const searchInput = document.querySelector("#librarySearch");
    searchInput?.addEventListener("input", (event) => {
      ui.librarySearch = event.target.value;
      renderLibrary();
      refreshIcons();
    });
    document.querySelector("#libraryBookSelect")?.addEventListener("change", (event) => {
      ui.librarySource = event.target.value || "books";
      renderLibrary();
    });
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function ensureMaterialBankLoaded() {
    if (materialBank && documentAnalysis && supplementalBank && ocrCatalog) {
      return Promise.resolve(materialBank);
    }
    if (materialBankLoading) return materialBankLoading;
    const loadScript = (source) =>
      new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-material-script="${source}"]`);
        if (existing) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = source;
        script.dataset.materialScript = source;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`数据加载失败：${source}`));
        document.head.append(script);
      });
    materialBankLoading = Promise.all([
      loadScript("./materials/document_analysis.js"),
      loadScript("./materials/material_questions.js"),
      loadScript("./materials/supplemental_questions.js"),
      loadScript("./materials/ocr_documents.js"),
    ])
      .then(() => {
        documentAnalysis =
          window.TAX_EXAM_DOCUMENT_ANALYSIS || { documentCount: 0, documents: [] };
        supplementalBank =
          window.TAX_EXAM_SUPPLEMENTAL_BANK || {
            questionCount: 0,
            completeAnswerCount: 0,
            missingAnswerCount: 0,
            questions: [],
            sourceStats: [],
          };
        ocrCatalog =
          window.TAX_EXAM_OCR_CATALOG || {
            documentCount: 0,
            completedCount: 0,
            documents: [],
          };
        materialBank = window.TAX_EXAM_MATERIAL_BANK || emptyMaterialBank;
        materialBankLoading = null;
        return materialBank;
      })
      .catch((error) => {
        materialBankLoading = null;
        throw error;
      });
    return materialBankLoading;
  }

  function renderDocumentAnalysisSection() {
    const documents = documentAnalysis?.documents || [];
    const subjects = ["all", ...new Set(documents.map((item) => item.subjectName))];
    const roles = ["all", ...new Set(documents.map((item) => item.roleName))];
    const statuses = ["all", ...new Set(documents.map((item) => item.status))];
    const query = ui.documentSearch.trim().toLowerCase();
    const filtered = documents.filter((document) => {
      if (ui.documentSubject !== "all" && document.subjectName !== ui.documentSubject) {
        return false;
      }
      if (ui.documentRole !== "all" && document.roleName !== ui.documentRole) {
        return false;
      }
      if (ui.documentStatus !== "all" && document.status !== ui.documentStatus) {
        return false;
      }
      if (
        query &&
        !`${document.name} ${document.relativePath} ${document.roleName}`.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
    const roleCounts = Object.entries(documentAnalysis?.byRole || {}).sort(
      (left, right) => right[1] - left[1],
    );
    const rows = filtered.slice(0, 120).map((document) => {
      const sourceUrl = materialFileSourceUrl(document.relativePath);
      return `
        <tr>
          <td><span class="type-badge ${document.extension === ".pdf" ? "single" : "multiple"}">${document.extension.replace(".", "").toUpperCase()}</span></td>
          <td class="question-cell">
            <strong>${htmlEscape(document.name)}</strong>
            <span>${htmlEscape(document.relativePath)}</span>
          </td>
          <td>${htmlEscape(document.subjectName)}</td>
          <td>${htmlEscape(document.roleName)}</td>
          <td>${document.extractedQuestionCount || 0}</td>
          <td>${document.features?.questionNumberCount || 0}</td>
          <td>${document.features?.answerMarkerCount || 0}</td>
          <td><span class="status-badge ${document.status === "需要OCR" || document.status === "缺答案" ? "wrong" : document.status === "可发布" ? "success" : ""}">${htmlEscape(document.status)}</span></td>
          <td><a class="button small" href="${htmlEscape(sourceUrl)}" target="_blank" rel="noopener">查看</a></td>
        </tr>
      `;
    });

    return `
      <section class="section">
        <div class="section-head">
          <div>
            <h2>文档作用清册</h2>
            <p>逐份识别文档职责、所属科目、题目含量、答案完整度和推荐归属</p>
          </div>
        </div>
        <div class="filter-bar">
          <select class="field" id="documentSubjectFilter">
            ${subjects
              .map(
                (value) =>
                  `<option value="${htmlEscape(value)}" ${ui.documentSubject === value ? "selected" : ""}>${value === "all" ? "全部科目" : htmlEscape(value)}</option>`,
              )
              .join("")}
          </select>
          <select class="field" id="documentRoleFilter">
            ${roles
              .map(
                (value) =>
                  `<option value="${htmlEscape(value)}" ${ui.documentRole === value ? "selected" : ""}>${value === "all" ? "全部作用" : htmlEscape(value)}</option>`,
              )
              .join("")}
          </select>
          <select class="field" id="documentStatusFilter">
            ${statuses
              .map(
                (value) =>
                  `<option value="${htmlEscape(value)}" ${ui.documentStatus === value ? "selected" : ""}>${value === "all" ? "全部状态" : htmlEscape(value)}</option>`,
              )
              .join("")}
          </select>
          <label class="field search-field">
            ${icon("search")}
            <input id="documentSearch" type="search" value="${htmlEscape(ui.documentSearch)}" placeholder="搜索文档名或路径" />
          </label>
        </div>
        <div class="surface surface-pad" style="margin-bottom:12px">
          <div class="bar-list">
            ${roleCounts
              .slice(0, 10)
              .map(
                ([role, count]) => `
                  <div class="bar-row">
                    <span>${htmlEscape(role)}</span>
                    <span class="bar-track"><span style="width:${Math.round((count / (documentAnalysis?.documentCount || 1)) * 100)}%"></span></span>
                    <b>${count}</b>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>格式</th><th>文档</th><th>科目</th><th>作用</th><th>已入候选</th><th>题号</th><th>答案标记</th><th>状态</th><th>来源</th></tr></thead>
            <tbody>${rows.join("")}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSupplementalSection() {
    const bank = supplementalBank || {
      questionCount: 0,
      completeAnswerCount: 0,
      missingAnswerCount: 0,
      bySubject: {},
      byMaterial: {},
      sourceStats: [],
    };
    const sources = (bank.sourceStats || [])
      .filter((item) => item.accepted > 0)
      .sort((left, right) => right.accepted - left.accepted)
      .slice(0, 30);
    return `
      <section class="section">
        <div class="section-head">
          <div>
            <h2>待补答案题目</h2>
            <p>从原先未识别的来源中补充提取，保留题干预选项，但答案不完整的题目不会进入正式题库</p>
          </div>
        </div>
        <div class="stats-grid">
          <article class="stat-card"><span class="stat-icon">${icon("file-search")}</span><span>补充提取</span><strong>${bank.questionCount || 0}</strong><small>${sources.length} 个有效来源显示中</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("badge-check")}</span><span>答案完整</span><strong>${bank.completeAnswerCount || 0}</strong><small>可进入优先审核</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("bot")}</span><span>AI建议待审</span><strong>${bank.suggestedAnswerCount || 0}</strong><small>已给出建议答案和置信度</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("triangle-alert")}</span><span>仍缺答案</span><strong>${bank.missingAnswerCount || 0}</strong><small>需补答案或人工确认</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("layers-3")}</span><span>涉及来源</span><strong>${sources.length}</strong><small>按提取数量倒序</small></article>
        </div>
        <div class="overview-split" style="margin-top:12px">
          <div class="surface surface-pad">
            <div class="section-head"><div><h2>科目分布</h2><p>补充题目按科目统计</p></div></div>
            <div class="bar-list">
              ${Object.entries(bank.bySubject || {})
                .sort((left, right) => right[1] - left[1])
                .map(
                  ([name, count]) => `
                    <div class="bar-row">
                      <span>${htmlEscape(name)}</span>
                      <span class="bar-track"><span style="width:${Math.round((count / Math.max(1, bank.questionCount)) * 100)}%"></span></span>
                      <b>${count}</b>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
          <div class="surface surface-pad">
            <div class="section-head"><div><h2>材料类型</h2><p>补充题目来自哪些材料</p></div></div>
            <div class="bar-list">
              ${Object.entries(bank.byMaterial || {})
                .sort((left, right) => right[1] - left[1])
                .map(
                  ([name, count]) => `
                    <div class="bar-row">
                      <span>${htmlEscape(name)}</span>
                      <span class="bar-track"><span style="width:${Math.round((count / Math.max(1, bank.questionCount)) * 100)}%"></span></span>
                      <b>${count}</b>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:12px">
          <table class="data-table">
            <thead><tr><th>来源</th><th>提取数量</th><th>原始解析数量</th><th>状态</th></tr></thead>
            <tbody>
              ${sources
                .map(
                  (item) => `
                    <tr>
                      <td class="question-cell"><strong>${htmlEscape(item.relativePath.split("/").pop())}</strong><span>${htmlEscape(item.relativePath)}</span></td>
                      <td>${item.accepted}</td>
                      <td>${item.parsed}</td>
                      <td><span class="status-badge wrong">待补答案</span></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderOcrSection() {
    const records = ocrCatalog?.documents || [];
    const totalChars = records.reduce(
      (total, record) => total + (record.ocrTextLength || 0),
      0,
    );
    return `
      <section class="section">
        <div class="section-head">
          <div>
            <h2>扫描件 OCR</h2>
            <p>图像型思维导图和扫描页面已识别为知识书文本索引，不直接转成题目</p>
          </div>
        </div>
        <div class="stats-grid">
          <article class="stat-card"><span class="stat-icon">${icon("scan-text")}</span><span>扫描件</span><strong>${ocrCatalog?.documentCount || 0}</strong><small>图片型 PDF</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("badge-check")}</span><span>OCR 完成</span><strong>${ocrCatalog?.completedCount || 0}</strong><small>Windows 中文 OCR</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("text-select")}</span><span>识别文字</span><strong>${Math.round(totalChars / 10000)} 万</strong><small>约 ${totalChars.toLocaleString()} 字</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("book-open-check")}</span><span>处理方式</span><strong>索引</strong><small>保留原图并供 Agent 引用</small></article>
        </div>
        <div class="list-stack" style="margin-top:12px">
          ${records
            .map((record) => {
              const filename = String(record.ocrTextPath || "")
                .replace(/\\/g, "/")
                .split("/")
                .pop();
              return `
                <div class="compact-row">
                  <span class="type-badge success">${record.ocrPageCount || 0}页</span>
                  <span class="row-copy">
                    <strong>${htmlEscape(record.name)}</strong>
                    <span>${htmlEscape(record.relativePath)} · OCR ${record.ocrTextLength || 0} 字</span>
                  </span>
                  ${
                    filename
                      ? `<a class="button small" href="/materials/ocr/${encodeURIComponent(filename)}" target="_blank" rel="noopener">查看文本</a>`
                      : `<span class="status-badge wrong">${htmlEscape(record.ocrStatus || "未完成")}</span>`
                  }
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  const READER_MATERIALS = ["高频考点与重难点", "三色笔记", "公式汇总"];

  function readerBooksForMaterial(material, subjectId) {
    return (knowledgeBookIndex.books || [])
      .filter(
        (book) =>
          book.materialName === material &&
          book.sectionCount > 0 &&
          (!subjectId || subjectId === "all" || book.subjectId === subjectId),
      )
      .sort((left, right) => right.sectionCount - left.sectionCount);
  }

  function saveReaderPrefs() {
    try {
      localStorage.setItem("tax-exam-reader-size", String(readerPrefs.size));
      localStorage.setItem("tax-exam-reader-line", String(readerPrefs.line));
      localStorage.setItem("tax-exam-reader-width", String(readerPrefs.width));
      localStorage.setItem("tax-exam-reader-theme", String(readerPrefs.theme));
    } catch (error) {
      console.warn("无法保存阅读偏好", error);
    }
  }

  function loadReaderBook(bookId) {
    if (readerCache.has(bookId)) return Promise.resolve(readerCache.get(bookId));
    const meta = knowledgeBookIndexById.get(bookId);
    if (!meta) return Promise.reject(new Error("找不到这本书"));
    return fetch(meta.contentPath, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`内容加载失败 ${response.status}`);
        return response.json();
      })
      .then((content) => {
        readerCache.set(bookId, content);
        return content;
      });
  }

  function readerSections(content) {
    return (content.sections || []).filter(
      (section) =>
        !section.junk &&
        (String(section.title || "").trim() || String(section.content || "").trim()),
    );
  }

  function markdownLite(text) {
    return nl2br(String(text || ""))
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^\s*([①②③④⑤⑥⑦⑧⑨⑩])/gm, '<span class="reader-marker">$1</span>')
      .replace(/【([^】]+)】/g, '<span class="reader-chip">$1</span>');
  }

  function renderReaderTable(text) {
    const lines = String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return "";
    const rows = lines.map((line) => reSplitColumns(line));
    const maxCols = Math.max(...rows.map((cells) => cells.length));
    if (maxCols < 2) return `<div class="reader-body">${markdownLite(text)}</div>`;
    const [head, ...rest] = rows;
    const headCols = head.length === maxCols ? head : null;
    const bodyRows = headCols ? rest : rows;
    return `
      <div class="reader-table-wrap">
        <table class="reader-table">
          ${headCols ? `<thead><tr>${headCols.map((cell) => `<th>${htmlEscape(cell)}</th>`).join("")}</tr></thead>` : ""}
          <tbody>
            ${bodyRows
              .map(
                (cells) =>
                  `<tr>${cells.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function reSplitColumns(line) {
    const parts = String(line).split(/\s{2,}|\t+/).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts : [String(line).trim()];
  }

  function renderEbook() {
    const material = READER_MATERIALS.includes(ui.ebookMaterial)
      ? ui.ebookMaterial
      : READER_MATERIALS[0];
    const subjectId = ui.ebookSubject || "all";
    const books = readerBooksForMaterial(material, subjectId);

    const subjectTabs = [
      { id: "all", name: "全部科目" },
      ...bank.subjects.map((subject) => ({ id: subject.id, name: subject.shortName })),
    ]
      .map(
        (item) => `
          <button type="button" class="${item.id === subjectId ? "active" : ""}" data-action="ebook-subject" data-subject-id="${item.id}">
            ${htmlEscape(item.name)}
          </button>
        `,
      )
      .join("");

    const materialTabs = READER_MATERIALS.map(
      (item) => `
        <button type="button" class="${item === material ? "active" : ""}" data-action="ebook-material" data-material="${htmlEscape(item)}">
          ${htmlEscape(item)}
        </button>
      `,
    ).join("");

    if (!books.length) {
      mainContent.innerHTML = `
        <div class="page ebook-page">
          ${pageHead("电子书", "高频考点 · 三色笔记 · 公式汇总，同一页面切换阅读", "")}
          <div class="ebook-toolbar">
            <div class="segmented">${materialTabs}</div>
            <div class="segmented ebook-subject-tabs">${subjectTabs}</div>
          </div>
          <div class="empty-state"><div><span class="empty-state-icon">${icon("book-x")}</span><h2>该科目暂无此类资料</h2><p>换一个科目或资料来源试试。</p></div></div>
        </div>
      `;
      refreshIcons();
      return;
    }

    const activeBook = books.find((book) => book.id === ui.ebookBookId) || books[0];
    ui.ebookBookId = activeBook.id;
    const generation = (ui.ebookGeneration || 0) + 1;
    ui.ebookGeneration = generation;

    if (!readerCache.has(activeBook.id)) {
      mainContent.innerHTML = `
        <div class="page ebook-page">
          ${pageHead("电子书", `${activeBook.subjectName} · ${activeBook.materialName} · ${activeBook.title}`, "")}
          <div class="ebook-toolbar">
            <div class="segmented">${materialTabs}</div>
            <div class="segmented ebook-subject-tabs">${subjectTabs}</div>
          </div>
          <div class="empty-state"><div><span class="empty-state-icon">${icon("loader-circle")}</span><h2>正在排版这本书</h2><p>首次打开需要加载内容，之后会自动缓存。</p></div></div>
        </div>
      `;
      refreshIcons();
      loadReaderBook(activeBook.id)
        .then(() => {
          if (ui.view === "recite" && ui.ebookGeneration === generation) renderEbook();
        })
        .catch((error) => toast("电子书加载失败", error.message, "error"));
      return;
    }

    const content = readerCache.get(activeBook.id);
    const sections = readerSections(content);
    const outline = buildReaderOutline(sections);
    const outlineRows = flattenOutline(outline);
    const activeRow = outlineRows.find((row) => row.id === ui.ebookChapterId);
    const scopeStart = activeRow ? activeRow.index : 0;
    const scopeEnd = activeRow ? activeRow.end : sections.length - 1;
    const scopedSections = sections.slice(scopeStart, scopeEnd + 1);
    const pageSize = 40;
    const pageCount = readerPageCount(scopedSections.length);
    const page = Math.min(Math.max(0, ui.ebookPage || 0), pageCount - 1);
    ui.ebookPage = page;
    const pageSections = scopedSections.slice(page * pageSize, page * pageSize + pageSize);
    const sectionId = ui.ebookSectionId || pageSections[0]?.id || "";
    ui.ebookSectionId = sectionId;
    const openState = ui.ebookOpenChapters || {};
    if (activeRow) {
      let parent = activeRow.parentId;
      while (parent) {
        openState[parent] = true;
        parent = outlineRows.find((row) => row.id === parent)?.parentId || "";
      }
    }
    ui.ebookOpenChapters = openState;

    const bookOptions = books
      .map(
        (book) =>
          `<option value="${book.id}" ${book.id === activeBook.id ? "selected" : ""}>${htmlEscape(book.title)}（${book.sectionCount}节）</option>`,
      )
      .join("");

    const tocMarkup = renderOutlineNodes(outline, 0, openState, ui.ebookChapterId);
    const scopeLabel = activeRow ? activeRow.title : "全书";

    const bodyRows = pageSections
      .map((section) => {
        const level = Math.min(Number(section.level) || 1, 3);
        const heading = String(section.title || "").trim();
        const format = String(section.format || "");
        const content = String(section.content || "").trim();
        const bodyOnly = readerBodyLike(section);
        let bodyMarkup = "";
        if (bodyOnly) {
          bodyMarkup = `<div class="reader-body reader-list reader-body-line">${markdownLite(heading)}</div>`;
        } else if (content) {
          if (format === "table") {
            bodyMarkup = renderReaderTable(content);
          } else if (format === "formula") {
            bodyMarkup = `<div class="reader-body reader-formula">${markdownLite(content)}</div>`;
          } else if (format === "list") {
            bodyMarkup = `<div class="reader-body reader-list">${markdownLite(content)}</div>`;
          } else if (format === "note") {
            bodyMarkup = `<div class="reader-body reader-note">${markdownLite(content)}</div>`;
          } else {
            bodyMarkup = `<div class="reader-body">${markdownLite(content)}</div>`;
          }
        }
        return `
          <section class="reader-section level-${level} format-${htmlEscape(format || "text")}${bodyOnly ? " body-line" : ""}" id="reader-section-${htmlEscape(section.id)}" data-section-id="${htmlEscape(section.id)}">
            ${heading && !bodyOnly ? `<h${level + 1} class="reader-heading">${htmlEscape(heading)}</h${level + 1}>` : ""}
            ${bodyMarkup}
          </section>
        `;
      })
      .join("");

    mainContent.innerHTML = `
      <div class="page ebook-page reader-theme-${htmlEscape(readerPrefs.theme)}">
        ${pageHead(
          "电子书",
          "高频考点 · 三色笔记 · 公式汇总，同一页面切换阅读",
          `<span class="scope-badge">${activeRow ? `筛选：${htmlEscape(scopeLabel)}（${scopedSections.length} 节）` : `全书 ${sections.length} 节`} · 共 ${pageCount} 页</span>`,
        )}

        <div class="ebook-toolbar">
          <div class="segmented">${materialTabs}</div>
          <div class="segmented ebook-subject-tabs">${subjectTabs}</div>
          <label class="field ebook-book-select">
            ${icon("book-open")}
            <select id="ebookBookSelect">${bookOptions}</select>
          </label>
          <div class="reader-controls">
            <button class="icon-button" type="button" data-action="ebook-font" data-delta="-1" title="缩小字号" aria-label="缩小字号">${icon("minus")}</button>
            <span class="reader-control-label" id="readerFontLabel">${readerPrefs.size}px</span>
            <button class="icon-button" type="button" data-action="ebook-font" data-delta="1" title="放大字号" aria-label="放大字号">${icon("plus")}</button>
            <span class="reader-divider"></span>
            <button class="icon-button" type="button" data-action="ebook-line" data-delta="-1" title="收紧行距" aria-label="收紧行距">${icon("align-justify")}</button>
            <span class="reader-control-label">${readerPrefs.line.toFixed(2)}</span>
            <button class="icon-button" type="button" data-action="ebook-line" data-delta="1" title="放松行距" aria-label="放松行距">${icon("align-justify")}</button>
            <span class="reader-divider"></span>
            <button class="icon-button ${readerPrefs.width === "narrow" ? "active" : ""}" type="button" data-action="ebook-width" data-width="narrow" title="窄版心" aria-label="窄版心">${icon("panel-left-close")}</button>
            <button class="icon-button ${readerPrefs.width === "normal" ? "active" : ""}" type="button" data-action="ebook-width" data-width="normal" title="标准版心" aria-label="标准版心">${icon("panel-left")}</button>
            <button class="icon-button ${readerPrefs.width === "wide" ? "active" : ""}" type="button" data-action="ebook-width" data-width="wide" title="宽版心" aria-label="宽版心">${icon("panel-left-open")}</button>
            <span class="reader-divider"></span>
            <button class="icon-button ${readerPrefs.theme === "paper" ? "active" : ""}" type="button" data-action="ebook-theme" data-theme="paper" title="纸白" aria-label="纸白">${icon("sun")}</button>
            <button class="icon-button ${readerPrefs.theme === "sepia" ? "active" : ""}" type="button" data-action="ebook-theme" data-theme="sepia" title="护眼" aria-label="护眼">${icon("leaf")}</button>
            <button class="icon-button ${readerPrefs.theme === "night" ? "active" : ""}" type="button" data-action="ebook-theme" data-theme="night" title="夜间" aria-label="夜间">${icon("moon")}</button>
          </div>
        </div>

        <div class="ebook-layout reader-width-${htmlEscape(readerPrefs.width)}">
          <aside class="reader-toc">
            <div class="reader-toc-head">
              <strong>目录筛选</strong>
              ${
                activeRow
                  ? `<button class="button small ghost" type="button" data-action="ebook-chapter-clear">${icon("x")}清除</button>`
                  : `<span>${outlineRows.length} 个条目</span>`
              }
            </div>
            <div class="reader-toc-list">${tocMarkup}</div>
          </aside>
          <article class="reader-paper">
            <header class="reader-title">
              <span class="eyebrow">${htmlEscape(activeBook.materialName)}</span>
              <h1>${htmlEscape(activeBook.title)}</h1>
              <p>${htmlEscape(activeBook.subjectName || "")} · 结构化阅读版</p>
            </header>
            <div class="reader-body-wrap">${bodyRows}</div>
            <footer class="reader-foot">
              <button class="button" type="button" data-action="ebook-page" data-page="${Math.max(0, page - 1)}" ${page === 0 ? "disabled" : ""}>${icon("arrow-left")}上一页</button>
              <span class="reader-page-indicator">${page + 1} / ${pageCount}</span>
              <button class="button primary" type="button" data-action="ebook-page" data-page="${Math.min(pageCount - 1, page + 1)}" ${page >= pageCount - 1 ? "disabled" : ""}>下一页${icon("arrow-right")}</button>
            </footer>
          </article>
        </div>
      </div>
    `;
    refreshIcons();
    applyReaderPrefs();
  }
  function scrollReaderTo(sectionId) {
    const target = document.querySelector(`#reader-section-${CSS.escape(sectionId)}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const READER_WIDTHS = { narrow: "640px", normal: "820px", wide: "1080px" };

  function applyReaderPrefs() {
    const page = document.querySelector(".ebook-page");
    if (!page) return;
    page.style.setProperty("--reader-size", `${readerPrefs.size}px`);
    page.style.setProperty("--reader-line", String(readerPrefs.line));
    page.style.setProperty("--reader-width", READER_WIDTHS[readerPrefs.width] || READER_WIDTHS.normal);
    page.classList.remove("reader-theme-paper", "reader-theme-sepia", "reader-theme-night");
    page.classList.add(`reader-theme-${readerPrefs.theme}`);
    const fontLabel = document.querySelector("#readerFontLabel");
    if (fontLabel) fontLabel.textContent = `${readerPrefs.size}px`;
    document.querySelectorAll('[data-action="ebook-width"]').forEach((button) => {
      button.classList.toggle("active", button.dataset.width === readerPrefs.width);
    });
    document.querySelectorAll('[data-action="ebook-theme"]').forEach((button) => {
      button.classList.toggle("active", button.dataset.theme === readerPrefs.theme);
    });
  }

  function readerPageCount(total) {
    return Math.max(1, Math.ceil(total / 40));
  }

  function buildReaderOutline(sections) {
    const chapters = [];
    const stack = [];
    sections.forEach((section, index) => {
      if (readerBodyLike(section)) return;
      const level = Math.min(Math.max(Number(section.level) || 1, 1), 3);
      const node = {
        id: section.id,
        title: String(section.title || "").trim() || `第 ${index + 1} 节`,
        level,
        index,
        children: [],
        end: index,
      };
      while (stack.length && stack[stack.length - 1].level >= level) {
        const closed = stack.pop();
        closed.end = index - 1;
        if (stack.length) stack[stack.length - 1].children.push(closed);
        else chapters.push(closed);
      }
      stack.push(node);
    });
    while (stack.length) {
      const closed = stack.pop();
      closed.end = sections.length - 1;
      if (stack.length) stack[stack.length - 1].children.push(closed);
      else chapters.push(closed);
    }
    return chapters;
  }

  function readerBodyLike(section) {
    const title = String(section.title || "").trim();
    const content = String(section.content || "").trim();
    if (content || !title) return false;
    if (/[。；;！？，,、：:]$/.test(title)) return true;
    return title.length > 22;
  }

  function flattenOutline(chapters) {
    const rows = [];
    const walk = (nodes, depth, parentId) => {
      nodes.forEach((node) => {
        rows.push({
          id: node.id,
          title: node.title,
          level: node.level,
          index: node.index,
          end: node.end,
          depth,
          parentId,
          hasChildren: node.children.length > 0,
        });
        if (node.children.length) walk(node.children, depth + 1, node.id);
      });
    };
    walk(chapters, 0, "");
    return rows;
  }

  function renderOutlineNodes(nodes, depth, openState, activeId) {
    return nodes
      .map((node) => {
        const isOpen = openState[node.id] === true;
        const isActive = node.id === activeId;
        const hasChildren = node.children.length > 0;
        return `
          <div class="reader-node depth-${Math.min(depth, 3)}">
            <div class="reader-node-head ${isActive ? "active" : ""}">
              ${
                hasChildren
                  ? `<button class="reader-node-toggle" type="button" data-action="ebook-chapter-toggle" data-chapter-id="${htmlEscape(node.id)}" aria-label="展开或收起">${icon(isOpen ? "chevron-down" : "chevron-right")}</button>`
                  : `<span class="reader-node-toggle placeholder"></span>`
              }
              <button class="reader-node-title" type="button" data-action="ebook-chapter" data-chapter-id="${htmlEscape(node.id)}">
                <span>${htmlEscape(node.title)}</span>
              </button>
            </div>
            ${
              hasChildren && isOpen
                ? `<div class="reader-node-children">${renderOutlineNodes(node.children, depth + 1, openState, activeId)}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");
  }
  function originalUrl(entry) {
    const segments = String(entry.relativePath || "").split("/").filter(Boolean);
    const encoded = segments.map((part) => encodeURIComponent(part)).join("/");
    if (CLOUD_MODE) return `./materials/source/${encoded}`;
    return `/materials-file/${encoded}`;
  }

  function originalKind(entry) {
    return /\.(png|jpe?g|webp|gif)$/i.test(entry.extension || "") ? "image" : "pdf";
  }

  function renderOriginals() {
    const entries = originalsCatalog.entries || [];
    const query = ui.originalSearch.trim().toLowerCase();
    const subjects = [
      { id: "all", name: "全部科目" },
      ...bank.subjects.map((subject) => ({ id: subject.id, name: subject.shortName })),
    ];
    const roles = [...new Set(entries.map((entry) => entry.role))];
    const list = entries.filter((entry) => {
      if (ui.originalSubject !== "all" && entry.subjectId !== ui.originalSubject) return false;
      if (ui.originalRole !== "all" && entry.role !== ui.originalRole) return false;
      if (query && !`${entry.title} ${entry.fileName} ${entry.role}`.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
    const groups = new Map();
    list.forEach((entry) => {
      const key = `${entry.subjectName} · ${entry.role}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const totalMb = ((originalsCatalog.totalBytes || 0) / 1024 / 1024).toFixed(1);
    mainContent.innerHTML = `
      <div class="page">
        ${pageHead(
          "原版资料",
          `直接看原始 PDF / 图片，全屏铺满、可双指放大；当前已收录 ${entries.length} 份（${totalMb} MB）`,
          `<button class="button" type="button" data-action="open-search">${icon("search")}搜题</button>`,
        )}
        <div class="filter-bar">
          <div class="segmented">
            ${subjects
              .map(
                (subject) => `
                  <button type="button" class="${ui.originalSubject === subject.id ? "active" : ""}" data-action="original-subject" data-subject-id="${subject.id}">
                    ${htmlEscape(subject.name)}
                  </button>
                `,
              )
              .join("")}
          </div>
          <label class="field">
            <select id="originalRoleSelect">
              <option value="all">全部类型</option>
              ${roles
                .map(
                  (role) =>
                    `<option value="${htmlEscape(role)}" ${ui.originalRole === role ? "selected" : ""}>${htmlEscape(role)}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="field search-field">
            ${icon("search")}
            <input id="originalSearch" type="search" value="${htmlEscape(ui.originalSearch)}" placeholder="搜索资料名称" />
          </label>
        </div>
        ${
          groups.size
            ? [...groups.entries()]
                .map(
                  ([groupName, rows]) => `
                    <section class="section">
                      <div class="section-head">
                        <div>
                          <h2>${htmlEscape(groupName)}</h2>
                          <p>${rows.length} 份原版资料</p>
                        </div>
                      </div>
                      <div class="original-grid">
                        ${rows
                          .map((entry) => {
                            const kind = originalKind(entry);
                            return `
                              <button class="original-card" type="button" data-action="open-original" data-original-id="${entry.id}">
                                <span class="original-icon ${kind}">${icon(kind === "image" ? "image" : "file-text")}</span>
                                <span class="original-copy">
                                  <strong>${htmlEscape(entry.title)}</strong>
                                  <span>${htmlEscape(entry.subjectName)} · ${htmlEscape(entry.role)} · ${(entry.size / 1024 / 1024).toFixed(1)} MB</span>
                                </span>
                                <span class="original-open-hint">${icon("maximize-2")}阅读</span>
                              </button>
                            `;
                          })
                          .join("")}
                      </div>
                    </section>
                  `,
                )
                .join("")
            : `<div class="empty-state"><div><span class="empty-state-icon">${icon("file-x")}</span><h2>没有匹配的原版资料</h2><p>换科目、类型或关键词试试。</p></div></div>`
        }
      </div>
    `;
    refreshIcons();
  }

  function originalViewerRoot() {
    let root = document.querySelector("#originalViewerRoot");
    if (!root) {
      root = document.createElement("div");
      root.id = "originalViewerRoot";
      document.body.append(root);
    }
    return root;
  }

  function renderOriginalViewer() {
    const root = originalViewerRoot();
    const entry = originalById.get(ui.originalId);
    if (!ui.originalVisible || !entry) {
      root.innerHTML = "";
      document.body.classList.remove("original-open");
      return;
    }
    const url = originalUrl(entry);
    const kind = originalKind(entry);
    const zoom = ui.originalZoom;
    root.innerHTML = `
      <div class="original-viewer" id="originalViewer">
        <div class="original-bar">
          <div class="original-title">
            <strong>${htmlEscape(entry.title)}</strong>
            <span>${htmlEscape(entry.subjectName)} · ${htmlEscape(entry.role)}</span>
          </div>
          <div class="original-tools">
            <button class="icon-button" type="button" data-action="original-zoom" data-delta="-10" aria-label="缩小">${icon("minus")}</button>
            <span class="original-zoom-label">${zoom}%</span>
            <button class="icon-button" type="button" data-action="original-zoom" data-delta="10" aria-label="放大">${icon("plus")}</button>
            <button class="button small" type="button" data-action="original-zoom" data-delta="reset">100%</button>
            <button class="button small" type="button" data-action="original-fullscreen">${icon("maximize-2")}全屏</button>
            <a class="button small" href="${htmlEscape(url)}" target="_blank" rel="noopener">${icon("external-link")}新窗口</a>
            <button class="button small danger" type="button" data-action="original-close">${icon("x")}关闭</button>
          </div>
        </div>
        <div class="original-stage" id="originalStage">
          ${
            kind === "image"
              ? `<img id="originalImage" class="original-image" src="${htmlEscape(url)}" style="transform:scale(${zoom / 100})" alt="${htmlEscape(entry.title)}" />`
              : `<iframe id="originalFrame" class="original-frame" src="${htmlEscape(url)}#toolbar=0&navpanes=0&zoom=${zoom}" title="${htmlEscape(entry.title)}"></iframe>`
          }
        </div>
      </div>
    `;
    document.body.classList.add("original-open");
    refreshIcons();
    bindOriginalGestures();
  }

  function bindOriginalGestures() {
    const stage = document.querySelector("#originalStage");
    const image = document.querySelector("#originalImage");
    if (!stage || !image) return;
    let startDistance = 0;
    let startZoom = ui.originalZoom;
    stage.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 2) return;
        startDistance = Math.hypot(
          event.touches[0].clientX - event.touches[1].clientX,
          event.touches[0].clientY - event.touches[1].clientY,
        );
        startZoom = ui.originalZoom;
      },
      { passive: true },
    );
    stage.addEventListener(
      "touchmove",
      (event) => {
        if (event.touches.length !== 2 || !startDistance) return;
        event.preventDefault();
        const distance = Math.hypot(
          event.touches[0].clientX - event.touches[1].clientX,
          event.touches[0].clientY - event.touches[1].clientY,
        );
        ui.originalZoom = Math.min(600, Math.max(30, Math.round((startZoom * distance) / startDistance)));
        image.style.transform = `scale(${ui.originalZoom / 100})`;
        const label = document.querySelector(".original-zoom-label");
        if (label) label.textContent = `${ui.originalZoom}%`;
      },
      { passive: false },
    );
    stage.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        ui.originalZoom = Math.min(600, Math.max(30, ui.originalZoom - Math.sign(event.deltaY) * 10));
        image.style.transform = `scale(${ui.originalZoom / 100})`;
        const label = document.querySelector(".original-zoom-label");
        if (label) label.textContent = `${ui.originalZoom}%`;
      },
      { passive: false },
    );
  }

  function renderContentStudio() {
    if (!materialBank) {
      mainContent.innerHTML = `
        <div class="page">
          ${pageHead("内容编辑", "正在加载候选题库与质量审核数据", "")}
          <div class="empty-state">
            <div>
              <span class="empty-state-icon">${icon("loader-circle")}</span>
              <h2>正在载入候选题库</h2>
              <p>首次进入需要加载本地提取数据。</p>
            </div>
          </div>
        </div>
      `;
      refreshIcons();
      ensureMaterialBankLoaded()
        .then(() => {
          if (ui.view === "studio") renderContentStudio();
        })
        .catch((error) => {
          toast("候选题库加载失败", error.message, "error");
        });
      return;
    }

    const bank = materialBank;
    const stats = bank.sourceStats || [];
    const zeroSources = stats.filter((item) => item.accepted === 0);
    const subjectIds = ["all", ...new Set(stats.map((item) => item.subjectId))];
    const subjectNameById = new Map(
      stats.map((item) => [item.subjectId, item.relativePath.split("/")[0]]),
    );
    const materialNames = [
      "all",
      ...new Set((bank.questions || []).map((question) => question.materialName)),
    ];
    const query = ui.studioSearch.trim().toLowerCase();
    const questions = (bank.questions || []).filter((question) => {
      const review = state.materialReview[question.id] || { status: "pending" };
      if (ui.studioSubject !== "all" && question.subjectId !== ui.studioSubject) return false;
      if (ui.studioMaterial !== "all" && question.materialName !== ui.studioMaterial) return false;
      if (ui.studioStatus !== "all" && review.status !== ui.studioStatus) return false;
      if (
        query &&
        !`${question.prompt} ${question.sourceRelativePath}`.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });

    const rows = questions.slice(0, 200).map((question) => {
      const review = state.materialReview[question.id] || { status: "pending" };
      const answer = question.answer?.join("") || question.answerText?.slice(0, 30) || "待补充";
      const statusLabel =
        review.status === "approved"
          ? "已通过"
          : review.status === "revise"
            ? "待修订"
            : "待审核";
      const statusClass =
        review.status === "approved"
          ? "success"
          : review.status === "revise"
            ? "wrong"
            : "";
      const sourceUrl = materialFileSourceUrl(question.sourceRelativePath);
      return `
        <article class="surface surface-pad" style="margin-bottom:10px">
          <div class="filter-bar" style="margin:0 0 9px">
            <span class="type-badge ${question.type}">${htmlEscape(TYPE_LABELS[question.type] || question.typeLabel)}</span>
            <span class="scope-badge">${htmlEscape(question.subjectName)} · ${htmlEscape(question.materialName)}</span>
            <span class="status-badge ${statusClass}">${statusLabel}</span>
            <span class="scope-badge">答案 ${htmlEscape(answer)}</span>
          </div>
          <strong style="white-space:pre-wrap">${nl2br(question.prompt.slice(0, 220))}</strong>
          <p class="text-muted" style="font-size:11px;margin:7px 0 0">${htmlEscape(question.sourceRelativePath)}</p>
          <div class="filter-bar" style="margin:10px 0 0">
            <button class="button small success" type="button" data-action="material-review-approve" data-question-id="${question.id}">${icon("check")}通过</button>
            <button class="button small danger" type="button" data-action="material-review-revise" data-question-id="${question.id}">${icon("triangle-alert")}待修订</button>
            <a class="button small" href="${htmlEscape(sourceUrl)}" target="_blank" rel="noopener">${icon("external-link")}查看来源</a>
          </div>
        </article>
      `;
    });

    mainContent.innerHTML = `
      <div class="page">
        ${pageHead("内容编辑", "对材料解析结果进行来源追溯、质量审核和发布前校验", `
          <button class="button" type="button" data-action="export-material-review">${icon("download")}导出审核结果</button>
          <button class="button" type="button" data-action="open-material-sources">${icon("folder-open")}查看源目录</button>
        `)}
        <div class="stats-grid">
          <article class="stat-card"><span class="stat-icon">${icon("scan-text")}</span><span>已提取题目</span><strong>${bank.questionCount || 0}</strong><small>${stats.length} 个题目来源</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("copy-check")}</span><span>去重跳过</span><strong>${bank.duplicateCount || 0}</strong><small>按题干、选项和答案比对</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("triangle-alert")}</span><span>首轮未解析来源</span><strong>${zeroSources.length}</strong><small>已在补充题区和 OCR 区继续处理</small></article>
          <article class="stat-card"><span class="stat-icon">${icon("book-open-check")}</span><span>已审核题目</span><strong>${Object.values(state.materialReview).filter((item) => item.status === "approved").length}</strong><small>通过后可进入正式题库</small></article>
        </div>

        ${renderDocumentAnalysisSection()}

        ${renderSupplementalSection()}

        ${renderOcrSection()}

        <section class="section">
          <div class="section-head">
            <div>
              <h2>题目审核队列</h2>
              <p>当前显示 ${Math.min(questions.length, 200)} / ${questions.length} 条</p>
            </div>
          </div>
          <div class="filter-bar">
            <select class="field" id="studioSubjectFilter">
              ${subjectIds
                .map(
                  (subjectId) =>
                    `<option value="${htmlEscape(subjectId)}" ${ui.studioSubject === subjectId ? "selected" : ""}>${subjectId === "all" ? "全部科目" : htmlEscape(subjectNameById.get(subjectId) || subjectId)}</option>`,
                )
                .join("")}
            </select>
            <select class="field" id="studioMaterialFilter">
              ${materialNames
                .map(
                  (name) =>
                    `<option value="${htmlEscape(name)}" ${ui.studioMaterial === name ? "selected" : ""}>${name === "all" ? "全部材料" : htmlEscape(name)}</option>`,
                )
                .join("")}
            </select>
            <select class="field" id="studioStatusFilter">
              <option value="all" ${ui.studioStatus === "all" ? "selected" : ""}>全部状态</option>
              <option value="pending" ${ui.studioStatus === "pending" ? "selected" : ""}>待审核</option>
              <option value="approved" ${ui.studioStatus === "approved" ? "selected" : ""}>已通过</option>
              <option value="revise" ${ui.studioStatus === "revise" ? "selected" : ""}>待修订</option>
            </select>
            <label class="field search-field">
              ${icon("search")}
              <input id="studioSearch" type="search" value="${htmlEscape(ui.studioSearch)}" placeholder="搜索题干或来源" />
            </label>
          </div>
          ${rows.length ? rows.join("") : '<div class="empty-state"><div><h2>没有匹配的审核题目</h2><p>调整筛选条件。</p></div></div>'}
        </section>

        ${
          zeroSources.length
            ? `
              <section class="section">
                <div class="section-head">
                  <div>
                    <h2>未提取到题目的来源</h2>
                    <p>这些来源需要单独检查题型、答案标记或 OCR 质量</p>
                  </div>
                </div>
                <div class="list-stack">
                  ${zeroSources
                    .slice(0, 40)
                    .map(
                      (item) => `
                        <div class="compact-row">
                          <span class="type-badge ${item.materialId === "mock_questions" ? "multiple" : "single"}">${item.accepted}</span>
                          <span class="row-copy"><strong>${htmlEscape(item.relativePath.split("/").pop())}</strong><span>${htmlEscape(item.relativePath)}</span></span>
                        <a class="button small" href="${materialFileSourceUrl(item.relativePath)}" target="_blank" rel="noopener">${icon("external-link")}查看</a>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              </section>
            `
            : ""
        }
      </div>
    `;

    document.querySelector("#studioSearch")?.addEventListener("input", (event) => {
      ui.studioSearch = event.target.value;
      renderContentStudio();
      refreshIcons();
    });
    document.querySelector("#documentSearch")?.addEventListener("input", (event) => {
      ui.documentSearch = event.target.value;
      renderContentStudio();
      refreshIcons();
    });
  }

  function updateMaterialReview(questionId, status) {
    const review = materialReviewRecord(questionId);
    review.status = status;
    review.updatedAt = new Date().toISOString();
    saveState();
    renderContentStudio();
    refreshIcons();
  }

  function exportMaterialReview() {
    if (!materialBank) {
      toast("候选题库尚未加载", "请进入内容编辑并等待数据加载完成。", "error");
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      materialBank: {
        version: materialBank.version,
        questionCount: materialBank.questionCount,
        sourceFileCount: materialBank.sourceFileCount,
      },
      supplementalBank: supplementalBank
        ? {
            version: supplementalBank.version,
            questionCount: supplementalBank.questionCount,
            completeAnswerCount: supplementalBank.completeAnswerCount,
            missingAnswerCount: supplementalBank.missingAnswerCount,
          }
        : null,
      review: state.materialReview,
      approvedQuestions: (materialBank.questions || []).filter(
        (question) => state.materialReview[question.id]?.status === "approved",
      ),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tax-exam-material-review-${todayKey()}.json`;
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("审核结果已导出", "包含审核状态和已通过题目。", "success");
  }

  function sessionTitle(session) {
    if (!session) return "练习";
    if (session.scopeLabel) return session.scopeLabel;
    const chapter = chapterById.get(session.chapterId);
    return chapter ? chapter.name : "练习";
  }

  function renderPractice() {
    const session = state.activeSession;
    if (!session) {
      navigate("dashboard");
      return;
    }

    const question = questionById.get(session.questionIds[session.index]);
    if (!question) {
      navigate("dashboard");
      return;
    }
    const record = state.records[question.id] || {};
    const answer = session.answers?.[question.id] || null;
    const selected =
      session.mode === "exam"
        ? session.examSelections?.[question.id] || []
        : session.pendingSelection || answer?.selected || [];
    const showFeedback = session.mode !== "exam" && Boolean(answer);
    const isLong = question.options.length < 2;
    const canSubmit = isLong ? Boolean(session.pendingLongText?.trim()) : selected.length > 0;
    const isFavorite = Boolean(record.favorite);
    const answeredCount =
      session.mode === "exam"
        ? Object.values(session.examSelections || {}).filter((value) => value?.length).length
        : Object.keys(session.answers || {}).length;
    const total = session.questionIds.length;
    const complete = answeredCount === total;
    const examLast = session.mode === "exam" && session.index === total - 1;
    renderSidebar();

    const optionMarkup = isLong
      ? `
        <textarea class="field long-answer-box" id="pendingLongText" placeholder="写下你的答案要点，或直接查看参考答案">${htmlEscape(session.pendingLongText || "")}</textarea>
        <div class="question-footer-group" style="margin-top:12px">
          <button class="button" type="button" data-action="show-reference">${icon("eye")}查看参考答案</button>
          ${
            answer
              ? ""
              : `
                <button class="button danger" type="button" data-action="self-rate" data-rating="unknown">${icon("rotate-ccw")}不会</button>
                <button class="button" type="button" data-action="self-rate" data-rating="vague">${icon("circle-help")}需复习</button>
                <button class="button success" type="button" data-action="self-rate" data-rating="mastered">${icon("check")}已掌握</button>
              `
          }
        </div>
      `
      : `
        <div class="option-list">
          ${question.options
            .map((option) => {
              const chosen = selected.includes(option.key);
              const correct = showFeedback && question.answer.includes(option.key);
              const wrong = showFeedback && chosen && !question.answer.includes(option.key);
              return `
                <button class="option ${chosen ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}" type="button" data-action="select-option" data-option-key="${option.key}" ${showFeedback ? "disabled" : ""}>
                  <span class="option-key">${option.key}</span>
                  <span class="option-text">${nl2br(option.text)}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      `;

    const correctText = question.answer.length
      ? question.answer.join("")
      : question.answerText || "见参考答案";
    const feedbackMarkup = showFeedback
      ? `
        <div class="feedback ${answer.correct ? "correct" : "wrong"}">
          <span class="feedback-icon">${answer.correct ? "✓" : "×"}</span>
          <div>
            <strong>${answer.correct ? "回答正确" : "这道题需要加入复习"}</strong>
            <p>你的答案：${htmlEscape((answer.selected || []).join("") || answer.selfRatingLabel || "未填写")} · 正确答案：${htmlEscape(correctText)}</p>
            ${question.answerText ? `<p>${nl2br(question.answerText)}</p>` : ""}
            ${
              question.explanation
                ? `
                  <div class="explanation">
                    <span class="explanation-title">答案解析</span>
                    ${nl2br(question.explanation)}
                  </div>
                `
                : ""
            }
          </div>
        </div>
      `
      : "";

    const answerCells = session.questionIds
      .map((questionId, index) => {
        const item = questionById.get(questionId);
        const itemAnswer = session.answers?.[questionId];
        const examSelection = session.examSelections?.[questionId];
        let className = "";
        if (session.mode === "exam") {
          if (examSelection?.length) className = "answered";
        } else if (itemAnswer) {
          className = itemAnswer.correct ? "correct" : "wrong";
        }
        if (index === session.index) className += " current";
        const flagged = session.flags?.includes(questionId) ? "•" : "";
        return `<button class="answer-cell ${className}" type="button" data-action="jump-question" data-index="${index}" title="${htmlEscape(item?.prompt?.slice(0, 50) || "")}">${index + 1}${flagged}</button>`;
      })
      .join("");

    const nextDisabled = session.index >= total - 1;
    const footer = isLong
      ? `
        <div class="question-footer">
          <div class="question-footer-group">
            <button class="button" type="button" data-action="previous-question" ${session.index === 0 ? "disabled" : ""}>${icon("arrow-left")}上一题</button>
            <button class="button" type="button" data-action="toggle-flag">${icon("flag")}${session.flags?.includes(question.id) ? "取消标记" : "标记"}</button>
          </div>
          <div class="question-footer-group">
            <button class="button" type="button" data-action="next-question" ${nextDisabled ? "disabled" : ""}>下一题${icon("arrow-right")}</button>
            ${
              complete
                ? `<button class="button primary" type="button" data-action="finish-session">${icon("clipboard-check")}查看报告</button>`
                : ""
            }
          </div>
        </div>
      `
      : `
        <div class="question-footer">
          <div class="question-footer-group">
            <button class="button" type="button" data-action="previous-question" ${session.index === 0 ? "disabled" : ""}>${icon("arrow-left")}上一题</button>
            <button class="button" type="button" data-action="toggle-flag">${icon("flag")}${session.flags?.includes(question.id) ? "取消标记" : "标记"}</button>
          </div>
          <div class="question-footer-group">
            ${
              session.mode === "exam"
                ? `
                  <button class="button primary" type="button" data-action="${examLast ? "submit-exam" : "next-question"}">
                    ${examLast ? `${icon("send")}交卷` : `下一题${icon("arrow-right")}`}
                  </button>
                `
                : `
                  ${
                    showFeedback
                      ? `<button class="button ${nextDisabled ? "primary" : ""}" type="button" data-action="${nextDisabled ? "finish-session" : "next-question"}">${nextDisabled ? `${icon("clipboard-check")}查看报告` : `下一题${icon("arrow-right")}`}</button>`
                      : `<button class="button primary" type="button" data-action="submit-answer" ${canSubmit ? "" : "disabled"}>${icon("check")}提交答案</button>`
                  }
                `
            }
          </div>
        </div>
      `;

    mainContent.innerHTML = `
      <div class="page">
        <div class="practice-toolbar">
          <button class="icon-button practice-toolbar-back" type="button" data-action="pause-session" aria-label="暂存并返回">${icon("arrow-left")}</button>
          <div class="practice-session-copy">
            <strong>${htmlEscape(sessionTitle(session))}</strong>
            <span>${session.mode === "exam" ? "模拟考试" : "即时解析"} · 第 ${session.index + 1} / ${total} 题 · 已答 ${answeredCount}</span>
          </div>
          <span class="timer" id="sessionTimer">${session.mode === "exam" ? formatDuration(Math.max(0, (session.endsAt - Date.now()) / 1000)) : formatDuration((Date.now() - session.startedAt) / 1000)}</span>
          ${session.mode === "exam" ? `<button class="button small primary" type="button" data-action="submit-exam">${icon("send")}交卷</button>` : ""}
        </div>

        <div class="practice-layout">
          <section class="practice-main">
            <article class="question-panel">
              <div class="question-head">
                <span class="type-badge ${question.type}">${htmlEscape(TYPE_LABELS[question.type] || question.typeLabel)}</span>
                <span class="question-index">原题 ${question.number}</span>
                <span class="spacer"></span>
                <button class="icon-button" type="button" data-action="toggle-favorite" aria-label="${isFavorite ? "取消收藏" : "收藏"}" title="${isFavorite ? "取消收藏" : "收藏"}">
                  ${icon("star")}
                </button>
              </div>
              <h2 class="prompt">${nl2br(question.prompt)}</h2>
              ${optionMarkup}
              ${feedbackMarkup}
              ${footer}
            </article>
          </section>

          <aside class="answer-sheet surface">
            <div class="answer-sheet-head">
              <h2>答题卡</h2>
              <span class="text-muted">${answeredCount}/${total}</span>
            </div>
            <div class="answer-grid">${answerCells}</div>
            <div class="answer-legend">
              <span class="legend-item"><span class="legend-dot answered"></span>已答</span>
              ${session.mode === "exam" ? "" : `<span class="legend-item"><span class="legend-dot correct"></span>正确</span><span class="legend-item"><span class="legend-dot wrong"></span>错误</span>`}
              <span class="legend-item"><span class="legend-dot"></span>未答</span>
            </div>
            <div style="margin-top:14px">
              ${session.mode === "exam" ? `<button class="button primary" style="width:100%" type="button" data-action="submit-exam">${icon("send")}提交试卷</button>` : `<button class="button" style="width:100%" type="button" data-action="add-note">${icon("notebook-pen")}错因与笔记</button>`}
            </div>
          </aside>
        </div>
      </div>
    `;

    const longInput = document.querySelector("#pendingLongText");
    longInput?.addEventListener("input", (event) => {
      session.pendingLongText = event.target.value;
      saveState();
    });
    refreshIcons();
  }

  function renderSummary() {
    const summary = state.lastSummary;
    if (!summary) {
      navigate("dashboard");
      return;
    }

    const wrongItems = summary.wrongIds
      .map((questionId) => questionById.get(questionId))
      .filter(Boolean);
    const objectiveCount = Number(summary.objectiveCount) || summary.answered || 1;
    const accuracy = objectiveCount ? summary.correct / objectiveCount : 0;
    const subjectiveIds = Array.isArray(summary.subjectiveIds) ? summary.subjectiveIds : [];
    const preview = wrongItems.slice(0, 5);

    mainContent.innerHTML = `
      <div class="page session-summary">
        <section class="summary-head">
          <span class="eyebrow">${summary.mode === "exam" ? "模拟考试已完成" : "本章已完成"}</span>
          <h1>${htmlEscape(summary.scopeLabel)}</h1>
          <p>已完成 ${summary.answered} / ${summary.total} 题，客观题答对 ${summary.correct} 题，本轮错题 ${wrongItems.length} 题${subjectiveIds.length ? `，待自评 ${subjectiveIds.length} 题` : ""}。</p>
        </section>

        <div class="summary-stats">
          <div class="summary-stat"><span>客观题正确率</span><strong>${formatPercent(accuracy)}</strong></div>
          <div class="summary-stat"><span>客观题答对</span><strong>${summary.correct}</strong></div>
          <div class="summary-stat"><span>本轮错题</span><strong class="text-danger">${wrongItems.length}</strong></div>
          <div class="summary-stat"><span>用时</span><strong>${formatDuration(summary.elapsedSec)}</strong></div>
        </div>

        <div class="summary-actions">
          <button class="button primary" type="button" data-action="export-summary-wrong" ${wrongItems.length ? "" : "disabled"}>${icon("file-down")}导出本轮错题 Word</button>
          <button class="button" type="button" data-action="review-summary-wrong" ${wrongItems.length ? "" : "disabled"}>${icon("rotate-ccw")}错题重练</button>
          <button class="button" type="button" data-action="review-summary-subjective" ${subjectiveIds.length ? "" : "disabled"}>${icon("notebook-pen")}自评主观题${subjectiveIds.length ? ` ${subjectiveIds.length}` : ""}</button>
          <button class="button" type="button" data-view="wrong">${icon("notebook-tabs")}打开错题本</button>
          <button class="button ghost" type="button" data-view="dashboard">${icon("layout-dashboard")}返回总览</button>
        </div>

        <section class="section">
          <div class="section-head">
            <div>
              <h2>本轮错题</h2>
              <p>导出内容会包含原题、你的答案、正确答案、解析、错因和笔记</p>
            </div>
          </div>
          ${
            preview.length
              ? `
                <div class="wrong-preview">
                  ${preview
                    .map(
                      (question, index) => `
                        <article class="wrong-preview-item">
                          <strong>${index + 1}. ${htmlEscape(question.prompt.slice(0, 110))}</strong>
                          <p>${htmlEscape(question.subjectName)} · ${htmlEscape(question.chapterName)} · 正确答案 ${htmlEscape((question.answer || []).join("") || "见解析")}</p>
                        </article>
                      `,
                    )
                    .join("")}
                  ${wrongItems.length > preview.length ? `<p class="text-muted">另有 ${wrongItems.length - preview.length} 题将在 Word 中完整列出。</p>` : ""}
                </div>
              `
              : `
                <div class="empty-state">
                  <div>
                    <span class="empty-state-icon">${icon("badge-check")}</span>
                    <h2>本轮没有错题</h2>
                    <p>这一章的掌握情况很好。</p>
                  </div>
                </div>
              `
          }
        </section>
      </div>
    `;
  }

  function renderWrongBook(favoritesOnly) {
    const isFavorites = Boolean(favoritesOnly);
    const filters = {
      subject: ui.wrongSubject,
      chapter: ui.wrongChapter,
      type: ui.wrongType,
      query: ui.wrongSearch,
      sort: ui.wrongSort,
    };
    const rows = isFavorites
      ? favoriteQuestions().map((question) => ({ question, record: state.records[question.id] }))
      : wrongQuestionsForFilters(filters);
    const visibleRows = rows.slice(0, 500);
    const selectedSubject = subjectById.get(ui.wrongSubject);
    const chapterOptions = selectedSubject
      ? selectedSubject.chapters
          .map(
            (chapter) =>
              `<option value="${chapter.id}" ${ui.wrongChapter === chapter.id ? "selected" : ""}>${htmlEscape(chapter.name)}</option>`,
          )
          .join("")
      : "";

    const tableRows = visibleRows.length
      ? visibleRows
          .map(
            ({ question, record }) => `
              <tr>
                <td><span class="type-badge ${question.type}">${htmlEscape(TYPE_LABELS[question.type] || question.typeLabel)}</span></td>
                <td class="question-cell">
                  <strong>${htmlEscape(question.prompt.slice(0, 105))}</strong>
                  <span>${htmlEscape(question.subjectName)} · ${htmlEscape(question.chapterName)} · 原题 ${question.number}</span>
                </td>
                <td>${isFavorites ? `<span class="status-badge">已收藏</span>` : `<span class="status-badge wrong">错 ${record.wrongCount} 次</span>`}</td>
                <td>${htmlEscape(formatDateTime(record.lastAt))}</td>
                <td>
                  <div class="question-footer-group">
                    <button class="button small" type="button" data-action="open-question" data-question-id="${question.id}">${icon("eye")}查看</button>
                    <button class="button small primary" type="button" data-action="retry-question" data-question-id="${question.id}">${icon("rotate-ccw")}重做</button>
                  </div>
                </td>
              </tr>
            `,
          )
          .join("")
      : "";

    mainContent.innerHTML = `
      <div class="page">
        ${pageHead(
          isFavorites ? "收藏夹" : "错题本",
          isFavorites ? `共 ${rows.length} 道收藏题` : `共 ${rows.length} 道待复习错题`,
          `
            ${
              isFavorites
                ? `<button class="button primary" type="button" data-action="practice-favorites" ${rows.length ? "" : "disabled"}>${icon("play")}收藏题重练</button>`
                : `
                  <button class="button" type="button" data-action="export-wrong" ${rows.length ? "" : "disabled"}>${icon("file-down")}导出当前筛选 Word</button>
                  <button class="button primary" type="button" data-action="practice-wrong" ${rows.length ? "" : "disabled"}>${icon("rotate-ccw")}错题重练</button>
                `
            }
          `,
        )}

        ${
          isFavorites
            ? ""
            : `
              <div class="filter-bar">
                <label class="field search-field">
                  ${icon("search")}
                  <input id="wrongSearch" type="search" value="${htmlEscape(ui.wrongSearch)}" placeholder="搜索题干或选项" />
                </label>
                <select class="field" id="wrongSubjectFilter">
                  <option value="all">全部科目</option>
                  ${bank.subjects.map((subject) => `<option value="${subject.id}" ${ui.wrongSubject === subject.id ? "selected" : ""}>${htmlEscape(subject.shortName)}</option>`).join("")}
                </select>
                <select class="field" id="wrongChapterFilter" ${!selectedSubject ? "disabled" : ""}>
                  <option value="all">全部章节</option>
                  ${chapterOptions}
                </select>
                <select class="field" id="wrongTypeFilter">
                  <option value="all">全部题型</option>
                  ${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${ui.wrongType === value ? "selected" : ""}>${label}</option>`).join("")}
                </select>
                <select class="field" id="wrongSortFilter">
                  <option value="recent" ${ui.wrongSort === "recent" ? "selected" : ""}>最近错误</option>
                  <option value="wrongCount" ${ui.wrongSort === "wrongCount" ? "selected" : ""}>错误次数</option>
                  <option value="chapter" ${ui.wrongSort === "chapter" ? "selected" : ""}>按章节</option>
                </select>
              </div>
            `
        }

        ${
          visibleRows.length
            ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width:76px">题型</th>
                      <th>题目</th>
                      <th style="width:90px">状态</th>
                      <th style="width:120px">最近作答</th>
                      <th style="width:178px">操作</th>
                    </tr>
                  </thead>
                  <tbody>${tableRows}</tbody>
                </table>
              </div>
              ${rows.length > visibleRows.length ? `<p class="text-muted" style="margin-top:10px">当前显示前 ${visibleRows.length} 条，导出仍会包含筛选范围内的全部 ${rows.length} 题。</p>` : ""}
            `
            : `
              <div class="empty-state">
                <div>
                  <span class="empty-state-icon">${icon(isFavorites ? "star" : "notebook-tabs")}</span>
                  <h2>${isFavorites ? "还没有收藏题目" : "当前范围没有错题"}</h2>
                  <p>${isFavorites ? "做题时点击星标即可加入收藏夹。" : "调整筛选条件，或继续做章节练习。"}</p>
                </div>
              </div>
            `
        }
      </div>
    `;

    const wrongSearch = document.querySelector("#wrongSearch");
    wrongSearch?.addEventListener("input", (event) => {
      ui.wrongSearch = event.target.value;
      renderWrongBook(false);
      refreshIcons();
    });
  }

  function renderStats() {
    const overall = overallStats();
    const daily = lastSevenDays();
    const maxAnswered = Math.max(1, ...daily.map((item) => item.answered));
    const mostWrongChapters = [...chapterById.values()]
      .map((chapter) => ({ chapter, stats: chapterStats(chapter.id) }))
      .filter((item) => item.stats.wrong > 0)
      .sort((left, right) => right.stats.wrong - left.stats.wrong)
      .slice(0, 8);

    mainContent.innerHTML = `
      <div class="page">
        ${pageHead("学习统计", `累计作答 ${overall.attempts} 次 · 覆盖 ${overall.answered} 道题`, `
          <button class="button" type="button" data-action="open-settings">${icon("settings")}数据管理</button>
        `)}

        <div class="stats-grid">
          <article class="stat-card">
            <span class="stat-icon">${icon("target")}</span>
            <span>整体正确率</span>
            <strong>${formatPercent(overall.accuracy)}</strong>
            <small>${overall.correct} 次答对 / ${overall.attempts} 次作答</small>
          </article>
          <article class="stat-card">
            <span class="stat-icon">${icon("book-check")}</span>
            <span>已覆盖题目</span>
            <strong>${overall.answered}</strong>
            <small>题库完成度 ${formatPercent(overall.progress)}</small>
          </article>
          <article class="stat-card">
            <span class="stat-icon">${icon("notebook-tabs")}</span>
            <span>待复习错题</span>
            <strong>${overall.wrong}</strong>
            <small>收藏题目 ${overall.favorites}</small>
          </article>
          <article class="stat-card">
            <span class="stat-icon">${icon("timer")}</span>
            <span>累计练习时长</span>
            <strong>${Math.round(Object.values(state.daily).reduce((sum, item) => sum + (item.minutes || 0), 0))} 分</strong>
            <small>根据实际作答间隔估算</small>
          </article>
        </div>

        <section class="section overview-split">
          <div class="surface surface-pad">
            <div class="section-head">
              <div>
                <h2>近 7 日作答</h2>
                <p>柱高表示每日完成题量</p>
              </div>
            </div>
            <div class="chart-bars">
              ${daily
                .map(
                  (item) => `
                    <div class="chart-column">
                      <strong>${item.answered}</strong>
                      <span class="chart-column-bar" style="height:${Math.max(3, (item.answered / maxAnswered) * 120)}px"></span>
                      <span>${item.label}</span>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>
          <div class="surface surface-pad">
            <div class="section-head">
              <div>
                <h2>科目正确率</h2>
                <p>按累计作答计算</p>
              </div>
            </div>
            <div class="bar-list">
              ${bank.subjects
                .map((subject) => {
                  const stats = subjectStats(subject.id);
                  return `
                    <div class="bar-row">
                      <span>${htmlEscape(subject.shortName)}</span>
                      <span class="bar-track"><span style="width:${Math.round(stats.accuracy * 100)}%;background:${stats.accuracy >= 0.7 ? "var(--success)" : stats.accuracy >= 0.5 ? "var(--accent)" : "var(--danger)"}"></span></span>
                      <b>${stats.attempts ? formatPercent(stats.accuracy) : "--"}</b>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <h2>错题集中章节</h2>
              <p>优先复习错误数量较多的章节</p>
            </div>
          </div>
          ${
            mostWrongChapters.length
              ? `
                <div class="list-stack">
                  ${mostWrongChapters
                    .map(
                      ({ chapter, stats }) => `
                        <div class="compact-row">
                          <span class="chapter-number" style="width:38px;height:38px">${String(chapter.order).padStart(2, "0")}</span>
                          <span class="row-copy">
                            <strong>${htmlEscape(chapter.name)}</strong>
                            <span>${htmlEscape(chapter.subjectName)} · 已答 ${stats.answered}/${stats.total} · 正确率 ${stats.attempts ? formatPercent(stats.accuracy) : "--"}</span>
                          </span>
                          <button class="button small" type="button" data-action="open-start" data-chapter-id="${chapter.id}">${icon("play")}重练</button>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              `
              : `
                <div class="empty-state">
                  <div>
                    <span class="empty-state-icon">${icon("chart-no-axes-combined")}</span>
                    <h2>暂无错题统计</h2>
                    <p>开始练习后，这里会显示错题集中章节。</p>
                  </div>
                </div>
              `
          }
        </section>
      </div>
    `;
  }

  function lastSevenDays() {
    const result = [];
    const formatter = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = todayKey(date);
      const daily = state.daily[key] || { answered: 0, correct: 0, minutes: 0 };
      result.push({
        key,
        label: formatter.format(date),
        ...daily,
      });
    }
    return result;
  }

  function getSessionPool(mode, chapterId, subjectId, kinds, order) {
    let pool;
    if (mode === "wrong") {
      pool = wrongQuestionsForFilters({
        chapter: chapterId || "all",
        subject: subjectId || "all",
        sort: "recent",
      }).map((item) => item.question);
    } else if (mode === "favorite") {
      pool = favoriteQuestions();
    } else if (chapterId) {
      pool = chapterQuestions(chapterId);
    } else if (subjectId) {
      pool = subjectQuestions(subjectId);
    } else {
      pool = [...bank.questions];
    }

    if (kinds && kinds.length) {
      const allowed = new Set(kinds);
      pool = pool.filter((question) => allowed.has(question.type));
    }
    if (order === "random" || mode === "wrong" || mode === "favorite") {
      pool = shuffle(pool);
    }
    return pool;
  }

  function startSession(options) {
    const mode = options.mode || "practice";
    const pool = options.questionIdsOverride?.length
      ? options.questionIdsOverride.map((questionId) => questionById.get(questionId)).filter(Boolean)
      : getSessionPool(
          mode,
          options.chapterId,
          options.subjectId,
          options.kinds,
          options.order,
        );
    const count = Math.min(options.count || pool.length, pool.length);
    const questionIds = (options.order === "random" || mode === "wrong" || mode === "favorite"
      ? pool
      : pool
    )
      .slice(0, count)
      .map((question) => question.id);

    if (!questionIds.length) {
      toast("没有符合条件的题目", "请调整章节、题型或筛选范围。", "error");
      return;
    }

    const durationMin = mode === "exam" ? Math.max(1, Number(options.durationMin) || 60) : 0;
    const scopeLabel =
      options.scopeLabel ||
      (options.chapterId && chapterById.get(options.chapterId)
        ? chapterById.get(options.chapterId).name
        : options.subjectId && subjectById.get(options.subjectId)
          ? subjectById.get(options.subjectId).name
          : bank.title);

    state.activeSession = {
      id: `session-${Date.now()}`,
      mode,
      chapterId: options.chapterId || "",
      subjectId: options.subjectId || "",
      scopeLabel,
      questionIds,
      index: 0,
      answers: {},
      examSelections: {},
      pendingSelection: [],
      pendingLongText: "",
      flags: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      durationMin,
      endsAt: durationMin ? Date.now() + durationMin * 60 * 1000 : 0,
    };
    state.lastSummary = null;
    saveState();
    navigate("practice");
  }

  function currentSessionQuestion() {
    const session = state.activeSession;
    return session ? questionById.get(session.questionIds[session.index]) : null;
  }

  function selectOption(optionKey) {
    const session = state.activeSession;
    const question = currentSessionQuestion();
    if (!session || !question) return;
    const existingAnswer = session.answers?.[question.id];
    if (session.mode !== "exam" && existingAnswer) return;

    if (session.mode === "exam") {
      const selected = new Set(session.examSelections?.[question.id] || []);
      if (question.options.length && question.type !== "multiple" && question.answer.length <= 1) {
        selected.clear();
        selected.add(optionKey);
      } else if (selected.has(optionKey)) {
        selected.delete(optionKey);
      } else {
        selected.add(optionKey);
      }
      session.examSelections[question.id] = [...selected].sort();
    } else {
      const selected = new Set(session.pendingSelection || []);
      const allowMultiple = question.type === "multiple" || question.answer.length > 1;
      if (!allowMultiple) {
        selected.clear();
        selected.add(optionKey);
      } else if (selected.has(optionKey)) {
        selected.delete(optionKey);
      } else {
        selected.add(optionKey);
      }
      session.pendingSelection = [...selected].sort();
    }
    saveState();
    renderPractice();
  }

  function submitCurrentAnswer() {
    const session = state.activeSession;
    const question = currentSessionQuestion();
    if (!session || !question) return;

    let selected = question.options.length
      ? [...(session.pendingSelection || [])]
      : [];
    if (!question.options.length) {
      selected = [];
    }
    const correct =
      question.options.length > 0 &&
      answerKeysEqual(selected, question.answer);
    const answer = {
      selected,
      correct,
      submittedAt: new Date().toISOString(),
      selfRating: "",
      selfRatingLabel: "",
    };
    session.answers[question.id] = answer;
    session.pendingSelection = [];
    session.pendingLongText = "";
    updateRecordAfterAnswer(question, correct, selected);
    saveState();
    renderPractice();

    if (state.settings.autoNext && correct) {
      window.setTimeout(() => {
        if (state.activeSession === session && session.index < session.questionIds.length - 1) {
          session.index += 1;
          saveState();
          renderPractice();
        }
      }, 650);
    }
  }

  function selfRateCurrent(rating) {
    const session = state.activeSession;
    const question = currentSessionQuestion();
    if (!session || !question) return;
    const selfRatedWrong = rating !== "mastered";
    const correct = rating === "mastered";
    const answer = {
      selected: [],
      correct,
      submittedAt: new Date().toISOString(),
      selfRating: rating,
      selfRatingLabel:
        rating === "mastered" ? "已掌握" : rating === "vague" ? "需复习" : "不会",
    };
    session.answers[question.id] = answer;
    session.pendingLongText = "";
    updateRecordAfterAnswer(question, correct, [], {
      selfRating: rating,
      selfRatedWrong,
    });
    saveState();
    renderPractice();
  }

  function showReferenceAnswer() {
    const question = currentSessionQuestion();
    if (!question) return;
    openModal({
      title: "参考答案",
      body: `
        <p class="prompt" style="font-size:15px">${nl2br(question.prompt)}</p>
        <div class="surface surface-pad">
          <strong>参考答案</strong>
          <p style="white-space:pre-wrap">${nl2br(question.answerText || question.explanation || "暂无参考答案")}</p>
        </div>
      `,
      footer: `<button class="button" type="button" data-action="close-modal">关闭</button>`,
    });
  }

  function navigateQuestion(direction) {
    const session = state.activeSession;
    if (!session) return;
    const next = Math.max(0, Math.min(session.questionIds.length - 1, session.index + direction));
    if (next === session.index) return;
    session.index = next;
    session.pendingSelection = [];
    const current = currentSessionQuestion();
    if (current) {
      session.pendingLongText = session.answers?.[current.id] ? "" : "";
    }
    saveState();
    renderPractice();
  }

  function toggleFlag() {
    const session = state.activeSession;
    const question = currentSessionQuestion();
    if (!session || !question) return;
    const flags = new Set(session.flags || []);
    if (flags.has(question.id)) flags.delete(question.id);
    else flags.add(question.id);
    session.flags = [...flags];
    saveState();
    renderPractice();
  }

  function toggleFavorite() {
    const question = currentSessionQuestion() || (ui.modal?.questionId ? questionById.get(ui.modal.questionId) : null);
    if (!question) return;
    const record = recordFor(question.id, true);
    record.favorite = !record.favorite;
    saveState();
    renderSidebar();
    if (ui.view === "practice") renderPractice();
    else if (ui.modal?.type === "question") openQuestionDetail(question.id);
    toast(record.favorite ? "已加入收藏" : "已取消收藏", question.prompt.slice(0, 48));
  }

  function evaluateExam() {
    const session = state.activeSession;
    if (!session) return;
    session.questionIds.forEach((questionId) => {
      const question = questionById.get(questionId);
      const selected = session.examSelections?.[questionId] || [];
      const isObjective = question.options.length > 0;
      const correct = isObjective ? answerKeysEqual(selected, question.answer) : null;
      session.answers[questionId] = {
        selected,
        correct,
        needsSelfReview: !isObjective,
        submittedAt: new Date().toISOString(),
      };
      if (isObjective) {
        updateRecordAfterAnswer(question, correct, selected);
      }
    });
    saveState();
    finishSession();
  }

  function finishSession() {
    const session = state.activeSession;
    if (!session) return;
    const answers = Object.values(session.answers || {});
    const answered = answers.filter((answer) => answer.selected?.length || answer.selfRating).length;
    const correct = answers.filter((answer) => answer.correct === true).length;
    const wrongIds = session.questionIds.filter((questionId) => {
      const answer = session.answers?.[questionId];
      return answer?.correct === false;
    });
    const subjectiveIds = session.questionIds.filter((questionId) => {
      return session.answers?.[questionId]?.correct === null;
    });
    const objectiveCount = session.questionIds.filter((questionId) => {
      return questionById.get(questionId)?.options.length > 0;
    }).length;

    state.lastSummary = {
      sessionId: session.id,
      mode: session.mode,
      scopeLabel: sessionTitle(session),
      total: session.questionIds.length,
      answered: session.mode === "exam" ? session.questionIds.length : answered,
      correct,
      objectiveCount,
      wrongIds,
      subjectiveIds,
      elapsedSec: Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)),
      finishedAt: new Date().toISOString(),
    };
    state.activeSession = null;
    saveState();
    navigate("summary");
  }

  function pauseSession() {
    if (!state.activeSession) {
      navigate("dashboard");
      return;
    }
    saveState();
    toast("本次练习已暂存", "下次可从学习总览继续。");
    navigate("dashboard");
  }

  function discardSession() {
    openModal({
      title: "放弃本次练习",
      body: "<p>已提交的答题记录会保留，但本次未完成的练习进度将被清除。</p>",
      footer: `
        <button class="button" type="button" data-action="close-modal">取消</button>
        <button class="button danger" type="button" data-action="confirm-discard-session">确认放弃</button>
      `,
    });
  }

  function openStartModal(options) {
    const chapter = options.chapterId ? chapterById.get(options.chapterId) : null;
    const subject = options.subjectId ? subjectById.get(options.subjectId) : null;
    const pool = chapter
      ? chapterQuestions(chapter.id)
      : subject
        ? subjectQuestions(subject.id)
        : bank.questions;
    const typeCounts = {};
    pool.forEach((question) => {
      typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
    });
    const title = chapter ? chapter.name : subject ? `${subject.name}随机练习` : "自定义练习";
    const defaultCount = Math.min(pool.length, 20);

    openModal({
      title: "开始练习",
      subtitle: title,
      body: `
        <form id="startForm">
          <input type="hidden" id="startChapterId" value="${chapter?.id || ""}" />
          <input type="hidden" id="startSubjectId" value="${subject?.id || ""}" />
          <div class="form-grid">
            <div class="form-field">
              <label for="startMode">模式</label>
              <select class="field" id="startMode">
                <option value="practice">章节练习 · 即时解析</option>
                <option value="exam">模拟考试 · 交卷后评分</option>
              </select>
            </div>
            <div class="form-field">
              <label for="startOrder">题目顺序</label>
              <select class="field" id="startOrder">
                <option value="random">随机打乱</option>
                <option value="sequence">按原题顺序</option>
              </select>
            </div>
            <div class="form-field">
              <label for="startCount">题量</label>
              <select class="field" id="startCount">
                <option value="${Math.min(10, pool.length)}">10 题</option>
                <option value="${defaultCount}" selected>20 题</option>
                <option value="${Math.min(50, pool.length)}">50 题</option>
                <option value="${pool.length}">全部 ${pool.length} 题</option>
              </select>
            </div>
            <div class="form-field">
              <label for="startDuration">考试时长</label>
              <select class="field" id="startDuration">
                <option value="30">30 分钟</option>
                <option value="60" selected>60 分钟</option>
                <option value="90">90 分钟</option>
                <option value="120">120 分钟</option>
              </select>
            </div>
            <div class="form-field full">
              <label>题型范围</label>
              <div class="filter-bar" style="margin:0">
                ${Object.entries(typeCounts)
                  .map(
                    ([type, count]) => `
                      <label class="check-row field">
                        <input type="checkbox" name="startKind" value="${type}" checked />
                        <span>${htmlEscape(TYPE_LABELS[type] || type)} ${count}</span>
                      </label>
                    `,
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </form>
      `,
      footer: `
        <button class="button" type="button" data-action="close-modal">取消</button>
        <button class="button primary" type="button" data-action="start-configured">开始</button>
      `,
    });
  }

  function startConfiguredSession() {
    const mode = document.querySelector("#startMode")?.value || "practice";
    const order = document.querySelector("#startOrder")?.value || "random";
    const count = Number(document.querySelector("#startCount")?.value) || 20;
    const durationMin = Number(document.querySelector("#startDuration")?.value) || 60;
    const kinds = [...document.querySelectorAll('input[name="startKind"]:checked')].map(
      (input) => input.value,
    );
    const chapterId = document.querySelector("#startChapterId")?.value || "";
    const subjectId = document.querySelector("#startSubjectId")?.value || "";
    startSession({ mode, order, count, durationMin, kinds, chapterId, subjectId });
  }

  function openQuestionDetail(questionId) {
    const question = questionById.get(questionId);
    if (!question) return;
    const record = state.records[questionId] || {};
    const selected = record.lastAnswer || [];
    const options = question.options.length
      ? `
        <div class="list-stack">
          ${question.options
            .map(
              (option) => `
                <div class="compact-row" style="grid-template-columns:30px minmax(0,1fr)">
                  <span class="option-key ${record.lastAnswer?.includes(option.key) ? "selected" : ""}">${option.key}</span>
                  <span style="background:${question.answer.includes(option.key) ? "var(--success-soft)" : "transparent"};padding:2px 6px;border-radius:4px">${nl2br(option.text)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      `
      : "";

    openModal({
      type: "question",
      questionId,
      title: `${TYPE_LABELS[question.type] || question.typeLabel} · 原题 ${question.number}`,
      subtitle: `${question.subjectName} · ${question.chapterName}`,
      wide: true,
      body: `
        <h3 style="margin:0 0 14px;font-size:16px;white-space:pre-wrap">${nl2br(question.prompt)}</h3>
        ${options}
        <div class="surface surface-pad" style="margin-top:16px">
          <div class="filter-bar" style="margin:0 0 10px">
            <span class="status-badge ${record.lastCorrect === false ? "wrong" : record.lastCorrect ? "success" : ""}">${record.lastCorrect === false ? "上次答错" : record.lastCorrect ? "上次答对" : "未作答"}</span>
            <span class="scope-badge">我的答案 ${htmlEscape(selected.join("") || "未作答")}</span>
            <span class="scope-badge">正确答案 ${htmlEscape((question.answer || []).join("") || "见参考答案")}</span>
          </div>
          ${question.answerText ? `<p style="white-space:pre-wrap"><strong>参考答案</strong><br>${nl2br(question.answerText)}</p>` : ""}
          ${question.explanation ? `<div class="explanation" style="color:var(--text)"><span class="explanation-title">答案解析</span>${nl2br(question.explanation)}</div>` : ""}
        </div>
        <div class="form-grid" style="margin-top:16px">
          <div class="form-field">
            <label for="questionReason">错因</label>
            <select class="field" id="questionReason">
              <option value="">未标注</option>
              ${Object.entries(REASON_LABELS).map(([value, label]) => `<option value="${value}" ${record.reason === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
          <div class="form-field">
            <label>状态</label>
            <div class="check-row field">
              <button class="button small" type="button" data-action="toggle-favorite" data-question-id="${question.id}">${icon("star")}${record.favorite ? "取消收藏" : "收藏题目"}</button>
              <button class="button small success" type="button" data-action="mark-mastered">${icon("badge-check")}标记已掌握</button>
            </div>
          </div>
          <div class="form-field full">
            <label for="questionNote">笔记</label>
            <textarea class="field" id="questionNote" rows="4" placeholder="记录易错点、公式或判断依据">${htmlEscape(record.note || "")}</textarea>
          </div>
        </div>
      `,
      footer: `
        <button class="button" type="button" data-action="retry-question" data-question-id="${question.id}">${icon("rotate-ccw")}重做本题</button>
        <span class="spacer"></span>
        <button class="button" type="button" data-action="close-modal">关闭</button>
        <button class="button primary" type="button" data-action="save-question-meta">保存笔记</button>
      `,
    });
  }

  function saveQuestionMeta() {
    const questionId = ui.modal?.questionId;
    if (!questionId) return;
    const record = recordFor(questionId, true);
    record.reason = document.querySelector("#questionReason")?.value || "";
    record.note = document.querySelector("#questionNote")?.value || "";
    saveState();
    toast("笔记已保存", "导出错题 Word 时会一并写入。");
    closeModal();
    render();
  }

  function markCurrentQuestionMastered() {
    const questionId = ui.modal?.questionId;
    if (!questionId) return;
    const record = recordFor(questionId, true);
    record.mastery = 3;
    record.streak = Math.max(record.streak || 0, 3);
    record.nextReviewAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    saveState();
    toast("已标记掌握", "该题会从待复习错题中移出。");
    closeModal();
    render();
  }

  function openSearchModal() {
    openModal({
      type: "search",
      title: "搜索题库",
      subtitle: `可检索 ${bank.questions.length} 道题的题干与选项`,
      wide: true,
      body: `
        <label class="field search-field" style="width:100%">
          ${icon("search")}
          <input id="globalSearchInput" type="search" autofocus placeholder="输入关键词，例如：增值税、股东、固定资产" />
        </label>
        <div class="search-results" id="globalSearchResults" style="margin-top:14px"></div>
      `,
      footer: `<button class="button" type="button" data-action="close-modal">关闭</button>`,
    });

    const input = document.querySelector("#globalSearchInput");
    const results = document.querySelector("#globalSearchResults");
    const run = () => {
      const query = input.value.trim().toLowerCase();
      if (!query) {
        results.innerHTML = '<p class="text-muted">输入 2 个以上字符开始搜索。</p>';
        return;
      }
      const matches = bank.questions
        .filter((question) => {
          const haystack = `${question.prompt} ${question.options.map((option) => option.text).join(" ")}`.toLowerCase();
          return haystack.includes(query);
        })
        .slice(0, 30);
      results.innerHTML = matches.length
        ? matches
            .map(
              (question) => `
                <button class="search-result" type="button" data-action="open-question" data-question-id="${question.id}">
                  <span class="type-badge ${question.type}">${htmlEscape(TYPE_LABELS[question.type] || question.typeLabel)}</span>
                  <span>
                    <strong>${htmlEscape(question.prompt.slice(0, 90))}</strong>
                    <p>${htmlEscape(question.subjectName)} · ${htmlEscape(question.chapterName)}</p>
                  </span>
                  ${icon("chevron-right")}
                </button>
              `,
            )
            .join("")
        : '<p class="text-muted">没有匹配题目。</p>';
      refreshIcons();
    };
    input.addEventListener("input", run);
    input.focus();
  }

  function openSettingsModal() {
    const overall = overallStats();
    openModal({
      type: "settings",
      title: "设置与数据",
      subtitle: serverPersistenceAvailable ? "使用固定本机进度文件" : "浏览器本地保存",
      body: `
        <div class="form-grid">
          <div class="form-field">
            <label for="settingTheme">外观</label>
            <select class="field" id="settingTheme">
              <option value="light" ${state.settings.theme === "light" ? "selected" : ""}>浅色</option>
              <option value="dark" ${state.settings.theme === "dark" ? "selected" : ""}>深色</option>
            </select>
          </div>
          <div class="form-field">
            <label>作答节奏</label>
            <label class="check-row field">
              <input id="settingAutoNext" type="checkbox" ${state.settings.autoNext ? "checked" : ""} />
              <span>答对后自动进入下一题</span>
            </label>
          </div>
        </div>
        <div class="surface surface-pad" style="margin-top:18px">
          <div class="filter-bar" style="margin:0 0 12px">
            <span class="scope-badge">地址 ${htmlEscape(location.origin)}</span>
            <span class="scope-badge">${serverPersistenceAvailable ? "文件同步已启用" : "文件同步不可用"}</span>
            <span class="scope-badge">固定位置 LocalAppData\\TaxExamQuiz\\progress.json</span>
          </div>
          <div class="filter-bar" style="margin:0 0 12px">
            <span class="scope-badge">已覆盖 ${overall.answered} 题</span>
            <span class="scope-badge">作答 ${overall.attempts} 次</span>
            <span class="scope-badge">错题 ${overall.wrong} 题</span>
          </div>
          <div class="filter-bar" style="margin:0">
            <button class="button" type="button" data-action="export-progress">${icon("download")}导出进度备份</button>
            <label class="button" for="progressImport">${icon("upload")}导入进度备份</label>
            <input id="progressImport" type="file" accept=".json" hidden />
            <button class="button danger" type="button" data-action="reset-progress">${icon("trash-2")}清空全部记录</button>
          </div>
        </div>
      `,
      footer: `
        <button class="button primary" type="button" data-action="save-settings">保存设置</button>
      `,
    });

    document.querySelector("#progressImport")?.addEventListener("change", importProgress);
  }

  function saveSettings() {
    state.settings.theme = document.querySelector("#settingTheme")?.value || "light";
    state.settings.autoNext = Boolean(document.querySelector("#settingAutoNext")?.checked);
    applyTheme();
    saveState();
    closeModal();
    toast("设置已保存");
  }

  function exportProgress() {
    const payload = JSON.stringify(
      {
        app: "tax-exam-quiz",
        exportedAt: new Date().toISOString(),
        bankVersion: bank.version,
        state,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tax-exam-progress-${todayKey()}.json`;
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("进度备份已导出");
  }

  function importProgress(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.state || parsed.app !== "tax-exam-quiz") throw new Error("文件格式不正确");
        state = {
          ...defaultState(),
          ...parsed.state,
          settings: { ...defaultState().settings, ...(parsed.state.settings || {}) },
        };
        applyTheme();
        saveState();
        closeModal();
        render();
        toast("进度已导入", `题库版本 ${parsed.bankVersion || "未知"}`);
      } catch (error) {
        toast("导入失败", error.message, "error");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function resetProgress() {
    openModal({
      title: "清空全部学习记录",
      body: "<p>这会删除答题记录、错题、收藏、笔记和当前未完成练习，但不会删除题库本身。</p>",
      footer: `
        <button class="button" type="button" data-action="close-modal">取消</button>
        <button class="button danger" type="button" data-action="confirm-reset">确认清空</button>
      `,
    });
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme === "dark" ? "dark" : "light";
    themeButton.innerHTML = `<i data-lucide="${state.settings.theme === "dark" ? "sun" : "moon-star"}"></i>`;
    refreshIcons();
  }

  function openModal(options) {
    closeModal(false);
    ui.modal = {
      type: options.type || "default",
      questionId: options.questionId || "",
    };
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="modal-backdrop">
        <section class="modal ${options.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${htmlEscape(options.title)}">
          <header class="modal-head">
            <div>
              <h2>${htmlEscape(options.title)}</h2>
              ${options.subtitle ? `<p class="text-muted" style="margin:3px 0 0;font-size:12px">${htmlEscape(options.subtitle)}</p>` : ""}
            </div>
            <button class="icon-button" type="button" data-action="close-modal" aria-label="关闭">${icon("x")}</button>
          </header>
          <div class="modal-body">${options.body || ""}</div>
          ${options.footer ? `<footer class="modal-foot">${options.footer}</footer>` : ""}
        </section>
      </div>
    `;
    refreshIcons();
  }

  function closeModal(clearUi) {
    modalRoot.innerHTML = "";
    if (clearUi !== false) ui.modal = null;
    else ui.modal = null;
  }

  function toast(title, message, type) {
    const node = document.createElement("div");
    node.className = `toast ${type || ""}`;
    node.innerHTML = `
      ${icon(type === "error" ? "circle-alert" : type === "success" ? "circle-check" : "info")}
      <div>
        <strong>${htmlEscape(title)}</strong>
        ${message ? `<span>${htmlEscape(message)}</span>` : ""}
      </div>
    `;
    toastStack.append(node);
    refreshIcons();
    window.setTimeout(() => node.remove(), 4200);
  }

  function startTimerIfNeeded() {
    const session = state.activeSession;
    if (!session || ui.view !== "practice") return;
    timerHandle = window.setInterval(updateTimer, 1000);
    updateTimer();
  }

  function stopTimer() {
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
  }

  function updateTimer() {
    const session = state.activeSession;
    const timer = document.querySelector("#sessionTimer");
    if (!session || !timer) return;
    timerDisplay = timer;
    if (session.mode === "exam") {
      const remaining = Math.max(0, (session.endsAt - Date.now()) / 1000);
      timer.textContent = formatDuration(remaining);
      timer.classList.toggle("warning", remaining <= 300);
      if (remaining <= 0 && ui.view === "practice") {
        stopTimer();
        toast("考试时间已到", "系统将自动交卷。", "error");
        evaluateExam();
      }
    } else {
      timer.textContent = formatDuration((Date.now() - session.startedAt) / 1000);
    }
  }

  function recommendedStart() {
    const candidates = [];
    bank.subjects.forEach((subject) => {
      subject.chapters.forEach((chapter) => {
        const stats = chapterStats(chapter.id);
        candidates.push({ chapter, stats });
      });
    });
    candidates.sort((left, right) => {
      if (left.stats.progress >= 1 && right.stats.progress < 1) return 1;
      if (right.stats.progress >= 1 && left.stats.progress < 1) return -1;
      if (left.stats.progress !== right.stats.progress) return left.stats.progress - right.stats.progress;
      return right.stats.wrong - left.stats.wrong;
    });
    const target = candidates[0];
    if (target) {
      startSession({
        mode: "practice",
        chapterId: target.chapter.id,
        count: Math.min(20, target.chapter.questionCount),
        order: "sequence",
        scopeLabel: target.chapter.name,
      });
    }
  }

  async function exportQuestions(questionIds, scopeLabel, filenamePrefix) {
    const items = questionIds.map((questionId) => questionById.get(questionId)).filter(Boolean);
    if (!items.length) {
      toast("没有可导出的错题", "当前范围内没有错题记录。", "error");
      return;
    }
    try {
      const filename = await window.TaxExamExport.downloadDocx(items, state.records, {
        title: `${scopeLabel} · 错题复习`,
        scopeLabel,
        filenamePrefix,
      });
      toast("Word 已导出", filename, "success");
    } catch (error) {
      console.error(error);
      toast("导出失败", error.message || "无法生成 Word 文件", "error");
    }
  }

  function exportChapterWrong(chapterId) {
    const chapter = chapterById.get(chapterId);
    const ids = chapterQuestions(chapterId)
      .filter((question) => {
        const record = state.records[question.id];
        return record?.wrongCount && !isMastered(record);
      })
      .sort((left, right) => String(state.records[right.id]?.lastWrongAt || "").localeCompare(String(state.records[left.id]?.lastWrongAt || "")))
      .map((question) => question.id);
    exportQuestions(ids, chapter?.name || "章节错题", `错题_${chapter?.name || "章节"}`);
  }

  function exportSubjectWrong(subjectId) {
    const subject = subjectById.get(subjectId);
    const ids = subjectQuestions(subjectId)
      .filter((question) => {
        const record = state.records[question.id];
        return record?.wrongCount && !isMastered(record);
      })
      .map((question) => question.id);
    exportQuestions(ids, `${subject?.name || "科目"}错题`, `错题_${subject?.shortName || "科目"}`);
  }

  function exportFilteredWrong() {
    const rows = wrongQuestionsForFilters({
      subject: ui.wrongSubject,
      chapter: ui.wrongChapter,
      type: ui.wrongType,
      query: ui.wrongSearch,
      sort: ui.wrongSort,
    });
    const scopeParts = [];
    if (ui.wrongSubject !== "all") scopeParts.push(subjectById.get(ui.wrongSubject)?.shortName);
    if (ui.wrongChapter !== "all") scopeParts.push(chapterById.get(ui.wrongChapter)?.name);
    if (ui.wrongType !== "all") scopeParts.push(TYPE_LABELS[ui.wrongType]);
    const scope = scopeParts.length ? scopeParts.join(" · ") : "全部待复习错题";
    exportQuestions(rows.map((item) => item.question.id), scope, `错题_${scope}`);
  }

  function retryQuestion(questionId) {
    const question = questionById.get(questionId);
    if (!question) return;
    startSession({
      mode: "practice",
      chapterId: question.chapterId,
      count: 1,
      order: "sequence",
      scopeLabel: `重做：${question.chapterName}`,
      questionIdsOverride: [questionId],
    });
  }

  function startWrongPractice() {
    const rows = wrongQuestionsForFilters({
      subject: ui.wrongSubject,
      chapter: ui.wrongChapter,
      type: ui.wrongType,
      query: ui.wrongSearch,
      sort: ui.wrongSort,
    });
    if (!rows.length) return;
    const questionIds = rows.slice(0, 100).map((item) => item.question.id);
    createSessionFromIds(questionIds, "错题重练", "practice");
  }

  function startFavoritePractice() {
    const questions = favoriteQuestions();
    if (!questions.length) return;
    createSessionFromIds(questions.map((question) => question.id), "收藏题重练", "practice");
  }

  function createSessionFromIds(questionIds, scopeLabel, mode) {
    if (!questionIds.length) return;
    state.activeSession = {
      id: `session-${Date.now()}`,
      mode: mode || "practice",
      chapterId: "",
      subjectId: "",
      scopeLabel,
      questionIds: [...questionIds],
      index: 0,
      answers: {},
      examSelections: {},
      pendingSelection: [],
      pendingLongText: "",
      flags: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      durationMin: 0,
      endsAt: 0,
    };
    state.lastSummary = null;
    saveState();
    navigate("practice");
  }

  function currentFilteredWrongIds() {
    return wrongQuestionsForFilters({
      subject: ui.wrongSubject,
      chapter: ui.wrongChapter,
      type: ui.wrongType,
      query: ui.wrongSearch,
      sort: ui.wrongSort,
    }).map((item) => item.question.id);
  }

  function updateWrongFilter(type, value) {
    if (type === "search") ui.wrongSearch = value;
    if (type === "subject") {
      ui.wrongSubject = value;
      ui.wrongChapter = "all";
    }
    if (type === "chapter") ui.wrongChapter = value;
    if (type === "type") ui.wrongType = value;
    if (type === "sort") ui.wrongSort = value;
    renderWrongBook(false);
    refreshIcons();
  }

  function handleAction(action, target) {
    switch (action) {
      case "continue-session":
        navigate("practice");
        break;
      case "discard-session":
        discardSession();
        break;
      case "confirm-discard-session":
        state.activeSession = null;
        saveState();
        closeModal();
        render();
        toast("已放弃本次练习");
        break;
      case "recommended-start":
        recommendedStart();
        break;
      case "switch-library-source":
        ui.librarySource = target.dataset.source || "all";
        renderLibrary();
        refreshIcons();
        break;
      case "switch-library-source-subject":
        ui.librarySubject = target.dataset.subjectId || ui.librarySubject;
        ui.librarySource = "books";
        navigate("library", { subjectId: ui.librarySubject });
        break;
      case "ebook-material":
        ui.ebookMaterial = target.dataset.material || READER_MATERIALS[0];
        ui.ebookBookId = "";
        ui.ebookSectionId = "";
        ui.ebookPage = 0;
        ui.ebookChapterId = "";
        renderEbook();
        break;
      case "ebook-subject":
        ui.ebookSubject = target.dataset.subjectId || "all";
        ui.ebookBookId = "";
        ui.ebookSectionId = "";
        ui.ebookPage = 0;
        ui.ebookChapterId = "";
        renderEbook();
        break;
      case "ebook-page":
        ui.ebookPage = Math.max(0, Number(target.dataset.page) || 0);
        ui.ebookSectionId = "";
        renderEbook();
        break;
      case "ebook-chapter":
        ui.ebookChapterId = target.dataset.chapterId || "";
        ui.ebookSectionId = "";
        ui.ebookPage = 0;
        renderEbook();
        break;
      case "ebook-chapter-toggle": {
        const chapterId = target.dataset.chapterId || "";
        if (!ui.ebookOpenChapters) ui.ebookOpenChapters = {};
        ui.ebookOpenChapters[chapterId] = ui.ebookOpenChapters[chapterId] === false;
        renderEbook();
        break;
      }
      case "ebook-chapter-clear":
        ui.ebookChapterId = "";
        ui.ebookSectionId = "";
        ui.ebookPage = 0;
        renderEbook();
        break;
      case "ebook-section":
        ui.ebookSectionId = target.dataset.sectionId || "";
        document
          .querySelectorAll(".reader-toc-row")
          .forEach((row) => row.classList.toggle("active", row === target));
        scrollReaderTo(ui.ebookSectionId);
        break;
      case "ebook-font":
        readerPrefs.size = Math.min(30, Math.max(13, readerPrefs.size + Number(target.dataset.delta || 0) * 2));
        saveReaderPrefs();
        applyReaderPrefs();
        break;
      case "ebook-line":
        readerPrefs.line = Math.min(2.6, Math.max(1.4, Number((readerPrefs.line + Number(target.dataset.delta || 0) * 0.15).toFixed(2))));
        saveReaderPrefs();
        applyReaderPrefs();
        break;
      case "ebook-width":
        readerPrefs.width = target.dataset.width || "normal";
        saveReaderPrefs();
        applyReaderPrefs();
        break;
      case "ebook-theme":
        readerPrefs.theme = target.dataset.theme || "paper";
        saveReaderPrefs();
        applyReaderPrefs();
        break;
      case "ebook-top":
        document.querySelector(".reader-paper")?.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      case "original-subject":
        ui.originalSubject = target.dataset.subjectId || "all";
        renderOriginals();
        break;
      case "open-original":
        ui.originalId = target.dataset.originalId || "";
        ui.originalZoom = 100;
        ui.originalVisible = true;
        renderOriginalViewer();
        break;
      case "original-zoom": {
        const delta = target.dataset.delta;
        if (delta === "reset") ui.originalZoom = 100;
        else ui.originalZoom = Math.min(600, Math.max(30, ui.originalZoom + Number(delta || 0)));
        const entry = originalById.get(ui.originalId);
        const image = document.querySelector("#originalImage");
        const frame = document.querySelector("#originalFrame");
        const label = document.querySelector(".original-zoom-label");
        if (image) image.style.transform = `scale(${ui.originalZoom / 100})`;
        if (frame && entry) {
          frame.src = `${originalUrl(entry)}#toolbar=0&navpanes=0&zoom=${ui.originalZoom}`;
        }
        if (label) label.textContent = `${ui.originalZoom}%`;
        break;
      }
      case "original-fullscreen":
        if (document.fullscreenElement) document.exitFullscreen();
        else document.querySelector("#originalViewer")?.requestFullscreen?.();
        break;
      case "original-close":
        ui.originalVisible = false;
        renderOriginalViewer();
        break;
      case "review-wrong": {
        const pool = wrongQuestionsForFilters({ sort: "wrongCount" }).map(
          (item) => item.question,
        );
        if (!pool.length) {
          toast("暂无待复习错题", "完成练习后，错题会自动进入这里。", "error");
          break;
        }
        startSession({
          mode: "wrong",
          count: Math.min(20, pool.length),
          order: "random",
          scopeLabel: "错题重练",
        });
        break;
      }
      case "open-exam":
        openStartModal({});
        break;
      case "agent-ask": {
        const prompt = target.dataset.prompt || "";
        navigate("agent");
        if (prompt) sendAgentMessage(prompt);
        break;
      }
      case "open-subject":
        navigate("library", { subjectId: target.dataset.subjectId });
        break;
      case "switch-library-subject":
        ui.librarySubject = target.dataset.subjectId;
        ui.librarySearch = "";
        ui.librarySource = "all";
        renderLibrary();
        setActiveNavigation();
        refreshIcons();
        break;
      case "material-review-approve":
        updateMaterialReview(target.dataset.questionId, "approved");
        break;
      case "material-review-revise":
        updateMaterialReview(target.dataset.questionId, "revise");
        break;
      case "export-material-review":
        exportMaterialReview();
        break;
      case "open-material-sources":
        toast("源资料目录", "D:\\BaiduNetdiskDownload\\新建文件夹");
        break;
      case "agent-send":
        sendAgentMessage(document.querySelector("#agentInput")?.value || "");
        break;
      case "agent-suggestion":
        sendAgentMessage(target.dataset.prompt || "");
        break;
      case "clear-agent-chat":
        state.agentMessages = [];
        saveState();
        renderAgent();
        break;
      case "open-start":
        openStartModal({ chapterId: target.dataset.chapterId });
        break;
      case "open-start-subject":
        openStartModal({ subjectId: target.dataset.subjectId });
        break;
      case "start-configured":
        startConfiguredSession();
        break;
      case "pause-session":
        pauseSession();
        break;
      case "select-option":
        selectOption(target.dataset.optionKey);
        break;
      case "submit-answer":
        submitCurrentAnswer();
        break;
      case "self-rate":
        selfRateCurrent(target.dataset.rating);
        break;
      case "show-reference":
        showReferenceAnswer();
        break;
      case "previous-question":
        navigateQuestion(-1);
        break;
      case "next-question":
        navigateQuestion(1);
        break;
      case "jump-question":
        if (state.activeSession) {
          state.activeSession.index = Number(target.dataset.index);
          state.activeSession.pendingSelection = [];
          saveState();
          renderPractice();
        }
        break;
      case "toggle-flag":
        toggleFlag();
        break;
      case "toggle-favorite":
        toggleFavorite();
        break;
      case "finish-session":
        finishSession();
        break;
      case "submit-exam":
        if (window.confirm("确认提交试卷？提交后不能再修改答案。")) evaluateExam();
        break;
      case "add-note":
        openQuestionDetail(currentSessionQuestion()?.id);
        break;
      case "open-question":
        openQuestionDetail(target.dataset.questionId);
        break;
      case "retry-question":
        closeModal();
        retryQuestion(target.dataset.questionId);
        break;
      case "save-question-meta":
        saveQuestionMeta();
        break;
      case "mark-mastered":
        markCurrentQuestionMastered();
        break;
      case "export-chapter-wrong":
        exportChapterWrong(target.dataset.chapterId);
        break;
      case "export-subject-wrong":
        exportSubjectWrong(target.dataset.subjectId);
        break;
      case "export-wrong":
        exportFilteredWrong();
        break;
      case "export-summary-wrong":
        if (state.lastSummary) {
          exportQuestions(
            state.lastSummary.wrongIds,
            state.lastSummary.scopeLabel,
            `错题_${state.lastSummary.scopeLabel}`,
          );
        }
        break;
      case "review-summary-wrong":
        if (state.lastSummary?.wrongIds?.length) {
          createSessionFromIds(state.lastSummary.wrongIds, `${state.lastSummary.scopeLabel} · 错题重练`, "practice");
        }
        break;
      case "review-summary-subjective":
        if (state.lastSummary?.subjectiveIds?.length) {
          createSessionFromIds(
            state.lastSummary.subjectiveIds,
            `${state.lastSummary.scopeLabel} · 主观题自评`,
            "practice",
          );
        }
        break;
      case "practice-wrong":
        startWrongPractice();
        break;
      case "practice-favorites":
        startFavoritePractice();
        break;
      case "open-search":
        openSearchModal();
        break;
      case "open-settings":
        openSettingsModal();
        break;
      case "save-settings":
        saveSettings();
        break;
      case "export-progress":
        exportProgress();
        break;
      case "reset-progress":
        resetProgress();
        break;
      case "confirm-reset":
        {
          const nextGeneration = (Number(state.generation) || 1) + 1;
          state = defaultState();
          state.generation = nextGeneration;
          state.clearedAt = new Date().toISOString();
        }
        applyTheme();
        saveState();
        closeModal();
        ui.view = "dashboard";
        render();
        toast("学习记录已清空");
        break;
      case "close-modal":
        closeModal();
        break;
      case "modal-backdrop":
        if (target === eventTargetFromAction(target)) closeModal();
        break;
      default:
        break;
    }
  }

  function eventTargetFromAction(target) {
    return target;
  }

  primaryNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) navigate(button.dataset.view);
  });

  document.addEventListener("click", (event) => {
    const viewTarget = event.target.closest("[data-view]");
    if (viewTarget && !primaryNav.contains(viewTarget)) {
      navigate(viewTarget.dataset.view);
      return;
    }
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    if (actionTarget.dataset.action === "modal-backdrop" && event.target !== actionTarget) return;
    handleAction(actionTarget.dataset.action, actionTarget);
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "wrongSubjectFilter") updateWrongFilter("subject", target.value);
    if (target.id === "wrongChapterFilter") updateWrongFilter("chapter", target.value);
    if (target.id === "wrongTypeFilter") updateWrongFilter("type", target.value);
    if (target.id === "wrongSortFilter") updateWrongFilter("sort", target.value);
    if (target.id === "ebookBookSelect") {
      ui.ebookBookId = target.value;
      ui.ebookSectionId = "";
      ui.ebookPage = 0;
      ui.ebookChapterId = "";
      ui.ebookOpenChapters = {};
      renderEbook();
    }
    if (target.id === "originalRoleSelect") {
      ui.originalRole = target.value;
      renderOriginals();
    }
    if (target.id === "studioSubjectFilter") {
      ui.studioSubject = target.value;
      renderContentStudio();
      refreshIcons();
    }
    if (target.id === "studioMaterialFilter") {
      ui.studioMaterial = target.value;
      renderContentStudio();
      refreshIcons();
    }
    if (target.id === "studioStatusFilter") {
      ui.studioStatus = target.value;
      renderContentStudio();
      refreshIcons();
    }
    if (target.id === "documentSubjectFilter") {
      ui.documentSubject = target.value;
      renderContentStudio();
      refreshIcons();
    }
    if (target.id === "documentRoleFilter") {
      ui.documentRole = target.value;
      renderContentStudio();
      refreshIcons();
    }
    if (target.id === "documentStatusFilter") {
      ui.documentStatus = target.value;
      renderContentStudio();
      refreshIcons();
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "wrongSearch") updateWrongFilter("search", target.value);
    if (target.id === "originalSearch") {
      ui.originalSearch = target.value;
      renderOriginals();
      const input = document.querySelector("#originalSearch");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.originalVisible) {
      ui.originalVisible = false;
      renderOriginalViewer();
      return;
    }
    if (event.key === "Escape" && modalRoot.innerHTML) {
      closeModal();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && !modalRoot.innerHTML) {
      const actionable = event.target.closest?.('[data-action][role="button"]');
      if (actionable && actionable !== document.body) {
        event.preventDefault();
        actionable.click();
        return;
      }
    }
    if (ui.view !== "practice" || modalRoot.innerHTML) return;
    const activeTag = document.activeElement?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;
    const question = currentSessionQuestion();
    if (!question) return;

    if (/^[1-7]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      const option = question.options[index];
      if (option) {
        event.preventDefault();
        selectOption(option.key);
      }
    } else if (/^[a-gA-G]$/.test(event.key)) {
      const option = question.options.find((item) => item.key === event.key.toUpperCase());
      if (option) {
        event.preventDefault();
        selectOption(option.key);
      }
    } else if (event.key === "Enter") {
      const session = state.activeSession;
      if (session.mode === "exam") {
        navigateQuestion(1);
      } else if (session.answers?.[question.id]) {
        if (session.index >= session.questionIds.length - 1) finishSession();
        else navigateQuestion(1);
      } else {
        submitCurrentAnswer();
      }
    } else if (event.key === "ArrowLeft") {
      navigateQuestion(-1);
    } else if (event.key === "ArrowRight") {
      navigateQuestion(1);
    } else if (event.key.toLowerCase() === "s") {
      toggleFavorite();
    } else if (event.key.toLowerCase() === "f") {
      toggleFlag();
    }
  });

  sidebarToggle.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  sidebarScrim.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  searchButton.addEventListener("click", openSearchModal);
  settingsButton.addEventListener("click", openSettingsModal);
  themeButton.addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    applyTheme();
    saveState();
  });

  mainContent.innerHTML = `
    <div class="page">
      <div class="empty-state">
        <div>
          <span class="empty-state-icon">${icon("database")}</span>
          <h2>正在读取学习进度</h2>
          <p>正在检查本机进度文件与浏览器备份。</p>
        </div>
      </div>
    </div>
  `;
  refreshIcons();
  bootstrapPersistence();
})();
