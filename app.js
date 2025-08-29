import dotenv from "dotenv";
import { chromium } from "playwright";
import fs from "fs";
import { z } from "zod";
import readlineSync from "readline-sync";
import OpenAI from "openai";
import {
  Agent,
  Runner,
  tool,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  OpenAIProvider,
} from "@openai/agents";

dotenv.config();

// --- USER INPUTS ---
const firstName = readlineSync.question("Enter First Name: ");
const lastName = readlineSync.question("Enter Last Name: ");
const email = readlineSync.questionEMail("Enter Email: ");
const password = readlineSync.question("Enter Password: ", {
  hideEchoBack: true, // hides input for security
});

// --- HELPER ---
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// --- PLAYWRIGHT SETUP ---
const browser = await chromium.launch({
  headless: false,
  args: ["--start-maximized", "--disable-extensions", "--disable-file-system"],
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

// --- OPENAI SDK SETUP ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // use your OpenAI API key
});
const provider = new OpenAIProvider({ openAIClient: openai });

setDefaultOpenAIClient(openai);
setOpenAIAPI("chat_completions");
setTracingDisabled(true);

// --- TOOLS ---
const screenshot = tool({
  name: "screenshot",
  description: "Take screenshot of current page",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async execute() {
    const buffer = await page.screenshot();
    const file = `screenshot-${Date.now()}.png`;
    await fs.promises.writeFile(file, buffer);
    return { file };
  },
});

const openURL = tool({
  name: "open_url",
  description: "Open a webpage",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute({ url }) {
    await page.goto(url, { waitUntil: "networkidle" });
    await wait(2000);
    return { success: true };
  },
});

const getDOM = tool({
  name: "get_dom",
  description: "Inspect the page structure (forms, inputs, buttons)",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async execute() {
    return await page.evaluate(() => {
      const out = [];
      document
        .querySelectorAll("input, textarea, select, button")
        .forEach((el) => {
          out.push({
            tag: el.tagName.toLowerCase(),
            id: el.id,
            name: el.name,
            type: el.type,
            placeholder: el.placeholder,
            text: el.textContent?.trim(),
            className: el.className,
          });
        });
      return out;
    });
  },
});

const fillInput = tool({
  name: "fill_input",
  description: "Type value into input field",
  parameters: {
    type: "object",
    properties: {
      selectors: { type: "array", items: { type: "string" } },
      value: { type: "string" },
    },
    required: ["selectors", "value"],
    additionalProperties: false,
  },
  async execute({ selectors, value }) {
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, {
          state: "visible",
          timeout: 4000,
        });
        // Use fill for reliability (replaces content)
        await page.fill(selector, value);
        return { success: true, selector };
      } catch {}
    }
    throw new Error("Failed to fill input");
  },
});

const clickElement = tool({
  name: "click",
  description: "Click on a button/element",
  parameters: {
    type: "object",
    properties: {
      selectors: { type: "array", items: { type: "string" } },
    },
    required: ["selectors"],
    additionalProperties: false,
  },
  async execute({ selectors }) {
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, {
          state: "visible",
          timeout: 4000,
        });
        await page.click(selector);
        return { success: true, selector };
      } catch {}
    }
    throw new Error("Click failed");
  },
});

// Smarter fill by label/placeholder/aria/name/id
const fillField = tool({
  name: "fill_field",
  description:
    "Fill an input by human-readable label/placeholder/name/id (case-sensitive). Best for text, email, and password fields.",
  parameters: {
    type: "object",
    properties: {
      label: { type: "string" },
      value: { type: "string" },
    },
    required: ["label", "value"],
    additionalProperties: false,
  },
  async execute({ label, value }) {
    const attempts = [
      async () => page.getByLabel(label, { exact: false }).first(),
      async () => page.getByPlaceholder(label, { exact: false }).first(),
      async () =>
        page.getByRole("textbox", { name: new RegExp(label, "i") }).first(),
      async () =>
        page
          .locator(
            `input[aria-label*="${label}"],textarea[aria-label*="${label}"]`,
            { hasText: undefined }
          )
          .first(),
      async () =>
        page
          .locator(`input[name*="${label}"],textarea[name*="${label}"]`)
          .first(),
      async () =>
        page.locator(`input[id*="${label}"],textarea[id*="${label}"]`).first(),
      async () =>
        page
          .locator(`input[type="password"]`)
          .filter({ hasText: undefined })
          .first(), // fallback for password fields
    ];

    for (const getLocator of attempts) {
      try {
        const locator = await getLocator();
        await locator.waitFor({ state: "visible", timeout: 3000 });
        await locator.fill(value);
        return { success: true };
      } catch {}
    }
    throw new Error(`Unable to locate field for label "${label}"`);
  },
});

// Click button by visible text
const clickByText = tool({
  name: "click_by_text",
  description:
    'Click a button or submit element by visible text (case-insensitive), e.g., text="Create Account".',
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute({ text }) {
    const rx = new RegExp(text, "i");
    const attempts = [
      async () => page.getByRole("button", { name: rx }).first(),
      async () => page.locator(`button:has-text("${text}")`).first(),
      async () =>
        page.locator(`input[type="submit"][value*="${text}"]`).first(),
      async () => page.locator(`a:has-text("${text}")`).first(),
    ];
    for (const getLocator of attempts) {
      try {
        const locator = await getLocator();
        await locator.waitFor({ state: "visible", timeout: 3000 });
        await locator.click();
        return { success: true };
      } catch {}
    }
    throw new Error(`Unable to click element with text "${text}"`);
  },
});

// Auto-detect and fill form fields based on provided data
const autoFillForm = tool({
  name: "auto_fill_form",
  description:
    "Detect the main form on the page and fill fields from provided data (firstName, lastName, email, password, confirmPassword). Optionally submit.",
  parameters: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          password: { type: "string" },
          confirmPassword: { type: "string" },
        },
        required: [
          "firstName",
          "lastName",
          "email",
          "password",
          "confirmPassword",
        ],
        additionalProperties: false,
      },
      submit: { type: "boolean", default: true },
    },
    required: ["data", "submit"],
    additionalProperties: false,
  },
  async execute({ data, submit = true }) {
    const fieldToKeywords = {
      firstName: ["first name", "firstname", "given name", "given", "first"],
      lastName: ["last name", "lastname", "surname", "family name", "last"],
      email: ["email", "e-mail", "mail"],
      password: ["password", "passcode", "pwd"],
      confirmPassword: [
        "confirm password",
        "confirm",
        "retype password",
        "repeat password",
      ],
    };

    // Helper to try a series of locators and fill
    async function tryFillByKeywords(keywords, value) {
      for (const kw of keywords) {
        const attempts = [
          async () => page.getByLabel(new RegExp(kw, "i")).first(),
          async () => page.getByPlaceholder(new RegExp(kw, "i")).first(),
          async () =>
            page.getByRole("textbox", { name: new RegExp(kw, "i") }).first(),
          async () => page.locator(`input[aria-label*="${kw}"]`).first(),
          async () => page.locator(`textarea[aria-label*="${kw}"]`).first(),
          async () => page.locator(`input[name*="${kw}"]`).first(),
          async () => page.locator(`textarea[name*="${kw}"]`).first(),
          async () => page.locator(`input[id*="${kw}"]`).first(),
          async () => page.locator(`textarea[id*="${kw}"]`).first(),
        ];
        for (const getLocator of attempts) {
          try {
            const locator = await getLocator();
            await locator.waitFor({ state: "visible", timeout: 1500 });
            await locator.fill(value);
            return true;
          } catch {}
        }
      }
      return false;
    }

    // Choose the main form if present (with most inputs); else work page-wide
    let formLocator = page.locator("form");
    const formCount = await formLocator.count();
    if (formCount > 0) {
      // Pick the form with most fillable controls
      let bestIndex = 0;
      let bestScore = -1;
      for (let i = 0; i < formCount; i++) {
        const controls = await formLocator
          .nth(i)
          .locator("input, textarea, select")
          .count();
        if (controls > bestScore) {
          bestScore = controls;
          bestIndex = i;
        }
      }
      formLocator = formLocator.nth(bestIndex);
    } else {
      formLocator = page.locator("body");
    }

    // Fill known fields
    const fillOrder = [
      "firstName",
      "lastName",
      "email",
      "password",
      "confirmPassword",
    ];
    for (const key of fillOrder) {
      const value = data[key];
      if (!value) continue;
      const keywords = fieldToKeywords[key] || [key];
      const localized = [
        ...keywords,
        key,
        key.replace(/([A-Z])/g, " $1").trim(),
        key.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`).trim(),
      ];
      const filled = await tryFillByKeywords(localized, value);
      if (!filled && (key === "password" || key === "confirmPassword")) {
        // Try generic password fields
        try {
          const pw = await formLocator
            .locator('input[type="password"]')
            .first();
          await pw.waitFor({ state: "visible", timeout: 1500 });
          await pw.fill(value);
        } catch {}
      }
    }

    if (submit) {
      const submitTexts = [
        "create account",
        "sign up",
        "signup",
        "register",
        "submit",
        "continue",
        "next",
      ];
      for (const text of submitTexts) {
        try {
          const btn = formLocator
            .getByRole("button", { name: new RegExp(text, "i") })
            .first();
          await btn.waitFor({ state: "visible", timeout: 1200 });
          await btn.click();
          break;
        } catch {}
        try {
          const btn2 = formLocator
            .locator(`button:has-text("${text}")`)
            .first();
          await btn2.waitFor({ state: "visible", timeout: 1200 });
          await btn2.click();
          break;
        } catch {}
        try {
          const inp = formLocator.locator('input[type="submit"]').first();
          await inp.waitFor({ state: "visible", timeout: 1200 });
          await inp.click();
          break;
        } catch {}
      }
    }

    // Take a screenshot for confirmation
    const buffer = await page.screenshot();
    const file = `screenshot-${Date.now()}.png`;
    await fs.promises.writeFile(file, buffer);
    return { success: true, screenshot: file };
  },
});

// --- AGENT ---
const automationAgent = new Agent({
  name: "Web Automation Agent",
  instructions: `
You are a reliable browser automation agent.
Use the provided tools to navigate and fill forms.
Prefer "auto_fill_form" for forms; otherwise use "fill_field" over raw selectors.
After every action, take a screenshot.
`,
  tools: [
    screenshot,
    openURL,
    getDOM,
    fillInput,
    clickElement,
    fillField,
    clickByText,
    autoFillForm,
  ],
  model: "gpt-4.1-mini", // ✅ OpenAI model
});

// --- RUNNER ---
async function main() {
  const runner = new Runner({ modelProvider: provider });
  try {
    const response = await runner.run(
      automationAgent,
      `
    Go to https://ui.chaicode.com/auth/signup.
    Use auto_fill_form with this data and submit when ready:
    {
      "firstName": "${firstName}",
      "lastName": "${lastName}",
      "email": "${email}",
      "password": "${password}",
      "confirmPassword": "${password}"
    }
    `,
      { maxTurns: 20 }
    );

    console.log("Final Output:", response.finalOutput);
    await browser.close();
  } catch (err) {
    console.error("Agent failed:", err);
    await browser.close();
  }
}

main();
