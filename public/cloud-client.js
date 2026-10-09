(function () {
  "use strict";

  const isLocalhost = ["127.0.0.1", "localhost", ""].includes(window.location.hostname);
  const forceCloud = new URLSearchParams(window.location.search).has("cloud");
  const cloudMode = forceCloud || (window.location.protocol === "https:" && !isLocalhost);
  const TOKEN_KEY = "tax-exam-cloud-token";
  const ACCOUNT_KEY = "tax-exam-cloud-account";
  const originalFetch = window.fetch.bind(window);

  let loginPromise = null;
  let account = null;
  let token = "";

  window.TAX_QUIZ_CLOUD_MODE = cloudMode;

  function loadApp() {
    if (document.querySelector('script[data-tax-quiz-app="true"]')) return;
    const script = document.createElement("script");
    script.src = "./app.js";
    script.dataset.taxQuizApp = "true";
    document.body.append(script);
  }

  function jsonFetch(url, options) {
    return originalFetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(options?.headers || {}),
      },
    });
  }

  function clearSession() {
    token = "";
    account = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ACCOUNT_KEY);
    delete window.__TAX_QUIZ_STORAGE_KEY;
    delete window.TAX_QUIZ_ACCOUNT_LABEL;
  }

  function saveSession(nextToken, nextAccount) {
    token = nextToken;
    account = nextAccount;
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    window.__TAX_QUIZ_STORAGE_KEY = `tax-exam-quiz-state-v1::${account.userKey}`;
    window.TAX_QUIZ_ACCOUNT_LABEL = account.label || account.login;
  }

  function installAuthStyles() {
    if (document.querySelector("#cloud-auth-styles")) return;
    const style = document.createElement("style");
    style.id = "cloud-auth-styles";
    style.textContent = `
      body.cloud-auth-pending > .app-shell { visibility: hidden; }
      .cloud-gate {
        position: fixed;
        inset: 0;
        z-index: 500;
        display: grid;
        place-items: center;
        padding: 20px;
        background:
          linear-gradient(180deg, rgba(19, 48, 65, 0.96), rgba(17, 34, 45, 0.98));
      }
      .cloud-gate-panel {
        width: min(430px, 100%);
        padding: 28px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px;
        background: #ffffff;
        color: #17242c;
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.32);
      }
      .cloud-gate-mark {
        width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
        margin-bottom: 16px;
        border-radius: 8px;
        background: #1f5b87;
        color: #ffffff;
        font-size: 20px;
        font-weight: 800;
      }
      .cloud-gate h1 {
        margin: 0;
        font-size: 24px;
        line-height: 1.25;
      }
      .cloud-gate p {
        margin: 8px 0 20px;
        color: #667983;
        line-height: 1.6;
      }
      .cloud-gate label {
        display: grid;
        gap: 6px;
        margin-top: 12px;
        color: #52656e;
        font-size: 12px;
        font-weight: 700;
      }
      .cloud-gate input {
        width: 100%;
        min-height: 42px;
        padding: 8px 11px;
        border: 1px solid #c6d5db;
        border-radius: 6px;
        background: #ffffff;
        color: #17242c;
        font: inherit;
      }
      .cloud-gate button {
        width: 100%;
        min-height: 42px;
        margin-top: 18px;
        border: 0;
        border-radius: 6px;
        background: #1f5b87;
        color: #ffffff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .cloud-gate button:disabled {
        opacity: 0.6;
        cursor: wait;
      }
      .cloud-gate-error {
        min-height: 20px;
        margin-top: 10px;
        color: #b94436;
        font-size: 12px;
      }
      @media (max-width: 560px) {
        .cloud-gate {
          align-items: start;
          padding-top: 14vh;
        }
        .cloud-gate-panel {
          padding: 22px;
        }
      }
    `;
    document.head.append(style);
  }

  function showLogin(message) {
    installAuthStyles();
    document.body.classList.add("cloud-auth-pending");
    document.querySelector(".cloud-gate")?.remove();

    const gate = document.createElement("div");
    gate.className = "cloud-gate";
    gate.innerHTML = `
      <form class="cloud-gate-panel" id="cloudLoginForm">
        <div class="cloud-gate-mark">税</div>
        <h1>2026 税务师智能题库</h1>
        <p>登录后将读取该账号独立的云端学习进度。</p>
        <label>
          账号
          <input id="cloudLoginAccount" name="account" autocomplete="username" inputmode="numeric" required />
        </label>
        <label>
          密码
          <input id="cloudLoginPassword" name="password" type="password" autocomplete="current-password" required />
        </label>
        <div class="cloud-gate-error" id="cloudLoginError">${message || ""}</div>
        <button id="cloudLoginButton" type="submit">进入题库</button>
      </form>
    `;
    document.body.append(gate);

    const form = gate.querySelector("#cloudLoginForm");
    const accountInput = gate.querySelector("#cloudLoginAccount");
    const passwordInput = gate.querySelector("#cloudLoginPassword");
    const errorBox = gate.querySelector("#cloudLoginError");
    const submitButton = gate.querySelector("#cloudLoginButton");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.textContent = "";
      submitButton.disabled = true;
      submitButton.textContent = "正在登录";
      try {
        await login(accountInput.value.trim(), passwordInput.value);
        gate.remove();
        document.body.classList.remove("cloud-auth-pending");
        loadApp();
      } catch (error) {
        errorBox.textContent = error.message || "账号或密码错误";
        submitButton.disabled = false;
        submitButton.textContent = "进入题库";
        passwordInput.select();
      }
    });

    accountInput.focus();
  }

  async function login(loginValue, password) {
    const response = await jsonFetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ login: loginValue, password }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.token) {
      throw new Error(payload?.message || "账号或密码错误");
    }
    saveSession(payload.token, payload.account);
  }

  async function validateSession() {
    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    const savedAccount = sessionStorage.getItem(ACCOUNT_KEY);
    if (!savedToken || !savedAccount) return false;

    try {
      const response = await originalFetch("/api/session", {
        headers: { Authorization: `Bearer ${savedToken}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("session expired");
      const payload = await response.json();
      saveSession(savedToken, payload.account || JSON.parse(savedAccount));
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  async function ensureAuthenticated() {
    if (!cloudMode) return "";
    if (token) return token;
    if (loginPromise) return loginPromise;

    loginPromise = (async () => {
      const valid = await validateSession();
      if (valid) return token;
      return new Promise((resolve) => {
        const originalLogin = login;
        login = async (loginValue, password) => {
          await originalLogin(loginValue, password);
          resolve(token);
        };
        showLogin();
      });
    })();

    return loginPromise;
  }

  function authenticatedFetch(url, options) {
    return ensureAuthenticated().then((activeToken) => {
      return originalFetch(url, {
        ...options,
        headers: {
          ...(options?.headers || {}),
          Authorization: `Bearer ${activeToken}`,
        },
      });
    });
  }

  if (cloudMode) {
    window.fetch = function cloudAwareFetch(input, options) {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/__state__.json")) {
        return authenticatedFetch("/api/state", options);
      }
      if (url.startsWith("/api/analyze")) {
        return authenticatedFetch(url, options);
      }
      if (url.startsWith("/api/agent")) {
        return authenticatedFetch(url, options);
      }
      return originalFetch(input, options);
    };

    window.TaxQuizCloud = {
      logout() {
        clearSession();
        window.location.reload();
      },
      get account() {
        return account;
      },
    };

    showLogin();
    validateSession().then((valid) => {
      if (valid) {
        document.querySelector(".cloud-gate")?.remove();
        document.body.classList.remove("cloud-auth-pending");
        loadApp();
      }
    });
  } else {
    window.TaxQuizCloud = {
      logout() {},
      get account() {
        return null;
      },
    };
    loadApp();
  }
})();
