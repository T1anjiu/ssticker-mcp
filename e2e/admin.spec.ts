import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page): Promise<void> {
  const credentials = JSON.parse(await readFile(resolve(process.cwd(), ".tmp-e2e", "credentials.json"), "utf8")) as { token: string };
  await page.goto("/admin");
  await page.getByLabel("管理员令牌").fill(credentials.token);
  await page.getByRole("button", { name: "进入运营台" }).click();
  await expect(page.getByRole("heading", { name: "概览", level: 1 })).toBeVisible();
}

test("admin workflow is keyboard-accessible and has no serious axe findings", async ({ page }, testInfo) => {
  await login(page);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);

  await page.getByRole("link", { name: /素材库/ }).click();
  await expect(page.getByRole("heading", { name: "素材列表" })).toBeAttached();
  const entity = page.getByRole("button", { name: /待审核笑脸/ }).first();
  await entity.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "待审核笑脸" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭详情" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(entity).toBeFocused();

  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.locator(".sidebar")).toHaveCSS("position", "sticky");
  }
});
