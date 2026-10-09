import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const USERS = [
  {
    login: process.env.USER_A_LOGIN || "18264674337",
    password: process.env.USER_A_PASSWORD || "286351",
    userKey: "user-a",
    label: "账号一",
  },
  {
    login: process.env.USER_B_LOGIN || "286351",
    password: process.env.USER_B_PASSWORD || "18264674337",
    userKey: "user-b",
    label: "账号二",
  },
];

const SESSION_SECRET =
  process.env.SESSION_SECRET || "tax-exam-cloud-session-secret-change-me";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const STORE_NAME = "tax-quiz-progress";
const DEEPSEEK_API_KEY =
  process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const ANALYSIS_HISTORY_LIMIT = 160;

const AGENT_SYSTEM_PROMPT = `你是税务师考试全生命周期专业学习 Agent。你的服务对象是正在备考税务师五科的学习者。

年度和时间：
- 当前主要备考年度是 2026 年。
- 当前运行日期从"当前学习系统上下文"的 generatedAt 获取。
- 默认按 2026 考季处理，税务师考试通常安排在 11 月，具体日期以官方公告为准。
- 如果当前日期处于 2026 年 10 月至 11 月，默认进入冲刺月逻辑：错题、真题、限时模拟、薄弱章节优先。
- 如果当前日期早于 2026 年 8 月，按基础学习和章节训练为主。

知识优先级：
1. 用户本地 2026 教材、2026 大纲、2026 三色笔记、2026 高频考点和 2026 题目优先。
2. 2025 及以前真题只用于题型趋势、考点频率和历史理解，不直接当作 2026 新政策。
3. 上级推理模型和基础模型的稳定知识可以补充概念、原理、计算逻辑和考试方法。
4. 涉及 2026 税率、税收优惠、法律修订、教材变动或政策时效时，必须优先依赖本地 2026 资料；如果本地资料没有依据，要明确说明"需要核对 2026 最新资料"，不能凭记忆确定。
5. 当模型知识与本地 2026 资料冲突时，以本地 2026 资料为准，并提示冲突点。

你的职责：
1. 诊断：根据科目覆盖度、正确率、错题次数、平均答题时间和复习到期情况判断当前阶段。
2. 规划：输出可执行的日计划、周计划、30 天计划或冲刺计划，明确科目、章节、题量、时长和复盘方式。
3. 学习：把知识书、讲义、三色笔记、思维导图和公式资料组织成可理解的学习路径。
4. 出题与讲题：结合本地题库、错题和薄弱章节解释概念、选项、易错点和记忆方法。
5. 复习：对错题给出复习时间、复习顺序和重新练习方式。
6. 模考：根据剩余时间和掌握度安排模拟考试、时间分配和交卷后的分析。
7. 复盘：对阶段表现给出掌握度变化、风险点和下一阶段动作。

工作原则：
- 只根据用户提供的进度、题库、错题、书库目录和资料内容作答，不编造不存在的题目、章节或数据。
- 当数据不足时，明确说明缺少什么，而不是编造结论。
- 回答优先给出结论和下一步动作，再解释依据。
- 计划必须具体到科目、章节、题量、时间和复盘方式。
- 讲题时说明正确答案、错误选项原因、核心考点、记忆方法和下一次复习建议。
- 中文回答，专业、直接、可执行，避免空泛鼓励。`;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function safeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSession(account) {
  const payload = base64UrlEncode(
    JSON.stringify({
      userKey: account.userKey,
      label: account.label,
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    }),
  );
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");

  if (!safeEqual(signature, expected)) return null;

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return USERS.find((user) => user.userKey === session.userKey) || null;
  } catch {
    return null;
  }
}

function accessToken(event) {
  const header =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function accountFromEvent(event) {
  return verifySession(accessToken(event));
}

function bodyJson(event) {
  if (!event.body) return null;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw);
}

function stateKey(account) {
  return `progress/${account.userKey}.json`;
}

function analysisHistoryKey(account) {
  return `analysis/${account.userKey}/history.json`;
}

function buildRuleAnalysis(metrics) {
  const overall = metrics?.overall || {};
  const subjectRows = Array.isArray(metrics?.subjects) ? metrics.subjects : [];
  const chapterRows = Array.isArray(metrics?.chapters) ? metrics.chapters : [];
  const weakSubjects = [...subjectRows]
    .filter((item) => item.attempts > 0)
    .sort((left, right) => left.masteryScore - right.masteryScore)
    .slice(0, 3);
  const weakChapters = [...chapterRows]
    .filter((item) => item.attempts > 0)
    .sort((left, right) => left.masteryScore - right.masteryScore)
    .slice(0, 5);
  const slowSubjects = [...subjectRows]
    .filter((item) => item.averageAnswerSeconds > 0)
    .sort((left, right) => right.averageAnswerSeconds - left.averageAnswerSeconds)
    .slice(0, 3);

  const lines = [];
  lines.push(
    `整体掌握度为 ${Math.round(overall.masteryScore || 0)} 分，当前判断：${overall.level || "数据不足"}。`,
  );
  if (overall.attempts) {
    lines.push(
      `已完成 ${overall.answeredQuestions || 0} 道题、${overall.attempts || 0} 次作答，正确率 ${Math.round(overall.accuracy || 0)}%。`,
    );
  } else {
    lines.push("目前还没有足够作答记录，先完成一个章节后再分析更准确。");
  }
  if (overall.averageAnswerSeconds) {
    lines.push(
      `平均每道题约 ${overall.averageAnswerSeconds.toFixed(1)} 秒，${overall.averageAnswerSeconds > 150 ? "答题节奏偏慢，需要加强熟练度和快速判断。" : "答题节奏处于可练习区间。"} `,
    );
  }
  if (weakSubjects.length) {
    lines.push(
      `优先加强：${weakSubjects.map((item) => `${item.name}（${Math.round(item.masteryScore)}分）`).join("、")}。`,
    );
  }
  if (weakChapters.length) {
    lines.push(
      `薄弱章节：${weakChapters.map((item) => `${item.name}（${Math.round(item.masteryScore)}分）`).join("、")}。`,
    );
  }
  if (slowSubjects.length) {
    lines.push(
      `耗时较高：${slowSubjects.map((item) => `${item.name}（${item.averageAnswerSeconds.toFixed(1)}秒/题）`).join("、")}。`,
    );
  }
  if (overall.reviewDueCount) {
    lines.push(`有 ${overall.reviewDueCount} 道错题已到复习时间，建议先完成错题重练。`);
  }
  lines.push(
    "建议顺序：先复习到期错题，再练掌握度最低的章节，最后做一组限时题检查速度。",
  );
  return lines.join("\n\n");
}

async function analyzeWithDeepSeek(metrics) {
  if (!DEEPSEEK_API_KEY) return null;

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.3,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            "你是税务师考试学习分析师。请只根据输入的统计数据，用中文输出简洁、可执行的诊断。重点分析掌握程度、正确率、答题速度、记忆风险和下一阶段复习顺序。不要编造输入中不存在的数据，不要超过 450 字。",
        },
        {
          role: "user",
          content: JSON.stringify(metrics),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek response ${response.status}`);
  }
  const payload = await response.json();
  const text = String(payload.choices?.[0]?.message?.content || "").trim();
  return text || null;
}

async function runAgent(payload) {
  if (!DEEPSEEK_API_KEY) {
    const error = new Error("云端尚未配置 DeepSeek 密钥，请在 Netlify 环境变量设置 DEEPSEEK_API_KEY。");
    error.statusCode = 503;
    throw error;
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const context = payload?.context ? `\n\n当前学习系统上下文：\n${payload.context}` : "";
  const chat = [
    {
      role: "system",
      content: AGENT_SYSTEM_PROMPT + context,
    },
  ];
  for (const message of messages) {
    const role = String(message?.role || "").trim();
    const content = String(message?.content || "").trim();
    if (!role || !content) continue;
    if (!["user", "assistant", "system"].includes(role)) continue;
    chat.push({ role, content });
  }
  if (chat.length < 2) {
    const error = new Error("缺少提问内容");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.25,
      max_tokens: 1800,
      messages: chat,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`DeepSeek HTTP ${response.status}`);
    error.statusCode = 502;
    error.detail = raw.slice(0, 300);
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const error = new Error("DeepSeek 返回内容无法解析");
    error.statusCode = 502;
    throw error;
  }
  const answer = String(parsed.choices?.[0]?.message?.content || "").trim();
  if (!answer) {
    const error = new Error("Agent 没有返回内容");
    error.statusCode = 502;
    throw error;
  }
  return { answer, model: DEEPSEEK_MODEL, provider: "deepseek" };
}

function compactAnalysisMetrics(metrics) {
  const subjects = Array.isArray(metrics?.subjects) ? metrics.subjects : [];
  const chapters = Array.isArray(metrics?.chapters) ? metrics.chapters : [];
  const weakSubjects = [...subjects]
    .filter((item) => item.attempts > 0)
    .sort((left, right) => left.masteryScore - right.masteryScore)
    .slice(0, 3)
    .map((item) => ({
      name: item.name,
      masteryScore: Math.round(item.masteryScore || 0),
      accuracy: Math.round(item.accuracy || 0),
      averageAnswerSeconds: Number(item.averageAnswerSeconds || 0),
    }));
  const weakChapters = [...chapters]
    .filter((item) => item.attempts > 0)
    .sort((left, right) => left.masteryScore - right.masteryScore)
    .slice(0, 5)
    .map((item) => ({
      name: item.name,
      subjectName: item.subjectName || "",
      masteryScore: Math.round(item.masteryScore || 0),
      accuracy: Math.round(item.accuracy || 0),
    }));

  return {
    overall: {
      masteryScore: Math.round(metrics?.overall?.masteryScore || 0),
      level: metrics?.overall?.level || "数据不足",
      answeredQuestions: Number(metrics?.overall?.answeredQuestions || 0),
      attempts: Number(metrics?.overall?.attempts || 0),
      correct: Number(metrics?.overall?.correct || 0),
      accuracy: Math.round(metrics?.overall?.accuracy || 0),
      averageAnswerSeconds: Number(metrics?.overall?.averageAnswerSeconds || 0),
      reviewDueCount: Number(metrics?.overall?.reviewDueCount || 0),
    },
    weakSubjects,
    weakChapters,
  };
}

async function appendAnalysisHistory(store, account, result, metrics) {
  const key = analysisHistoryKey(account);
  const current = (await store.get(key, { type: "json" })) || { records: [] };
  const record = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    generatedAt: result.generatedAt,
    source: result.source,
    model: result.model || "",
    warning: result.warning || "",
    analysis: result.analysis,
    metrics: compactAnalysisMetrics(metrics),
  };
  const records = [record, ...(Array.isArray(current.records) ? current.records : [])]
    .slice(0, ANALYSIS_HISTORY_LIMIT);
  await store.setJSON(key, {
    userKey: account.userKey,
    updatedAt: new Date().toISOString(),
    records,
  });
  return record;
}

export async function handler(event) {
  const path = String(event.path || "").replace(/\/+$/, "");
  const method = String(event.httpMethod || "GET").toUpperCase();

  if (path.endsWith("/login") && method === "POST") {
    let body;
    try {
      body = bodyJson(event);
    } catch {
      return jsonResponse(400, { message: "登录信息格式错误" });
    }

    const account = USERS.find(
      (user) =>
        safeEqual(user.login, body?.login || "") &&
        safeEqual(user.password, body?.password || ""),
    );
    if (!account) {
      return jsonResponse(401, { message: "账号或密码错误" });
    }

    return jsonResponse(200, {
      token: signSession(account),
      account: {
        login: account.login,
        userKey: account.userKey,
        label: account.label,
      },
    });
  }

  const account = accountFromEvent(event);
  if (!account) {
    return jsonResponse(401, { message: "登录已失效，请重新登录" });
  }

  if (path.endsWith("/session") && method === "GET") {
    return jsonResponse(200, {
      account: {
        login: account.login,
        userKey: account.userKey,
        label: account.label,
      },
    });
  }

  if (path.endsWith("/agent") && method === "POST") {
    let payload;
    try {
      payload = bodyJson(event);
    } catch {
      return jsonResponse(400, { message: "提问格式错误" });
    }
    try {
      const result = await runAgent(payload);
      return jsonResponse(200, result);
    } catch (error) {
      console.error("Agent failed", error);
      return jsonResponse(error.statusCode || 500, {
        message: error.message || "专业 Agent 暂时不可用",
      });
    }
  }

  if (path.endsWith("/analyze/history") && method === "GET") {
    const store = getStore(STORE_NAME);
    const history = (await store.get(analysisHistoryKey(account), { type: "json" })) || {
      records: [],
    };
    return jsonResponse(200, history);
  }

  if (path.endsWith("/analyze") && method === "POST") {
    let payload;
    try {
      payload = bodyJson(event);
    } catch {
      return jsonResponse(400, { message: "分析数据格式错误" });
    }
    const metrics = payload?.metrics;
    if (!metrics || typeof metrics !== "object") {
      return jsonResponse(400, { message: "缺少分析数据" });
    }

    const ruleAnalysis = buildRuleAnalysis(metrics);
    let result;
    try {
      const aiAnalysis = await analyzeWithDeepSeek(metrics);
      result = {
        source: aiAnalysis ? "deepseek" : "rules",
        model: aiAnalysis ? DEEPSEEK_MODEL : "",
        analysis: aiAnalysis || ruleAnalysis,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error("AI analysis failed", error);
      result = {
        source: "rules",
        model: "",
        analysis: ruleAnalysis,
        warning: "DeepSeek 调用失败，已返回本地规则分析。",
        generatedAt: new Date().toISOString(),
      };
    }

    try {
      const store = getStore(STORE_NAME);
      await appendAnalysisHistory(store, account, result, metrics);
    } catch (error) {
      console.error("Failed to save analysis history", error);
      result.warning = result.warning || "分析已生成，但历史记录保存失败。";
    }
    return jsonResponse(200, result);
  }

  if (!path.endsWith("/state")) {
    return jsonResponse(404, { message: "接口不存在" });
  }

  const store = getStore(STORE_NAME);

  if (method === "GET") {
    const state = await store.get(stateKey(account), { type: "json" });
    return jsonResponse(200, state || {});
  }

  if (method === "PUT" || method === "POST") {
    let payload;
    try {
      payload = bodyJson(event);
    } catch {
      return jsonResponse(400, { message: "进度格式错误" });
    }
    if (!payload?.state || typeof payload.state !== "object") {
      return jsonResponse(400, { message: "缺少有效进度数据" });
    }

    const stored = {
      app: "tax-exam-quiz",
      bankVersion: payload.bankVersion || "",
      savedAt: new Date().toISOString(),
      account: {
        userKey: account.userKey,
        label: account.label,
      },
      state: payload.state,
    };
    await store.setJSON(stateKey(account), stored);
    return jsonResponse(200, { ok: true, savedAt: stored.savedAt });
  }

  return jsonResponse(405, { message: "不支持此请求方式" });
}
