import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import binaryen from "binaryen";

type HostileKind = "infinite-loop" | "stack-overflow" | "trap" | "rapid-allocation";

const hostileWasm = (original: Uint8Array, kind: HostileKind): Uint8Array => {
  const module = binaryen.readBinary(original);
  module.setFeatures(binaryen.Features.All);
  const exported = binaryen.getExportInfo(module.getExport("app"));
  const fn = module.getFunction(exported.value);
  const info = binaryen.getFunctionInfo(fn);
  const recursiveArguments = binaryen.expandType(info.params).map((type, index) => module.local.get(index, type));
  let body: number;
  if (kind === "infinite-loop") body = module.loop("tessyl_hostile_loop", module.br("tessyl_hostile_loop"));
  else if (kind === "stack-overflow") body = module.call(info.name, recursiveArguments, info.results);
  else if (kind === "rapid-allocation") body = module.loop("tessyl_allocation_loop", module.block(null, [module.drop(module.memory.grow(module.i32.const(1))), module.br("tessyl_allocation_loop")]));
  else body = module.unreachable();
  (binaryen as unknown as { _BinaryenFunctionSetBody(fn: number, body: number): void })._BinaryenFunctionSetBody(fn, body);
  if (!module.validate()) throw new Error("hostile fixture is invalid");
  return module.emitBinary();
};

const routeHostileCalculator = async (page: Page, kind: HostileKind): Promise<void> => {
  await page.route("**/assets/showcase/calculator.json", async (route) => {
    const response = await route.fetch();
    const artifact = await response.json() as { manifest: { wasmHash: string }; wasm: string };
    const wasm = hostileWasm(Buffer.from(artifact.wasm, "base64"), kind);
    artifact.wasm = Buffer.from(wasm).toString("base64");
    artifact.manifest.wasmHash = createHash("sha256").update(wasm).digest("hex");
    await route.fulfill({ response, body: JSON.stringify(artifact), contentType: "application/json" });
  });
};

test("three Tesserae start independently and remain accessible", async ({ page }) => {
  await page.goto("/showcase");
  for (const id of ["calculator", "chart", "simulation"]) {
    const card = page.locator(`[data-showcase-card="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(`[data-tessera-status="${id}"]`)).toHaveText("running");
    await expect(card.locator("iframe")).toHaveCount(1);
  }
  await expect(page.locator('[data-showcase-card="simulation"] iframe')).toHaveAttribute("data-tessyl-expanded-view", "true");
  await expect(page.locator('[data-showcase-card="calculator"] iframe')).toHaveAttribute("data-tessyl-expanded-view", "false");
  const calculator = page.frameLocator('[data-showcase-card="calculator"] iframe');
  await page.locator('[data-showcase-card="calculator"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await expect(calculator.getByRole("heading", { name: "Tip calculator" })).toBeVisible();
  const bill = calculator.getByLabel("Bill amount");
  await bill.click();
  await bill.press("ControlOrMeta+A");
  await bill.pressSequentially("100", { delay: 20 });
  await expect(bill).toBeFocused();
  await expect(calculator.getByLabel("Total")).toContainText("120");
  const chart = page.frameLocator('[data-showcase-card="chart"] iframe');
  await expect(chart.getByRole("figure", { name: "Value over four periods" })).toBeVisible();
  await expect(chart.getByRole("table", { name: "View chart data" })).toBeVisible();
  await expect(chart.getByRole("list", { name: "Legend" })).toContainText("Compounded");
  await expect(chart.getByRole("list", { name: "Legend" })).toContainText("Baseline");
  await expect(chart.locator('polyline[data-native-series="solid"]')).toHaveCount(1);
  await expect(chart.locator('polyline[data-native-series="dashed"]')).toHaveCount(1);
  const slider = chart.getByLabel("Growth factor");
  const box = await slider.boundingBox();
  if (!box) throw new Error("growth slider has no layout box");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(slider).toBeFocused();
});

test("reset creates a fresh generation without disturbing neighbors", async ({ page }) => {
  await page.goto("/showcase");
  const calculatorCard = page.locator('[data-showcase-card="calculator"]');
  await expect(calculatorCard.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  const calculator = page.frameLocator('[data-showcase-card="calculator"] iframe');
  await calculator.getByLabel("Bill amount").fill("100");
  await calculator.getByLabel("Bill amount").evaluate((input) => {
    for (let value = 101; value < 140; value += 1) {
      (input as HTMLInputElement).value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await calculatorCard.getByRole("button", { name: "Reset" }).click();
  await expect(calculatorCard.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await expect(page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount")).toHaveValue("48");
  await expect(page.locator('[data-tessera-status="chart"]')).not.toHaveText(/failed/i);
});

test("BFCache suspension preserves restart ownership", async ({ page }) => {
  await page.goto("/showcase");
  const card = page.locator('[data-showcase-card="calculator"]');
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await card.getByRole("button", { name: "Reset" }).click();
  await expect(page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount")).toHaveValue("48");
});

test("offscreen runtimes pause and restart without losing their fallback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/showcase");
  const calculator = page.locator('[data-showcase-card="calculator"]');
  await expect(calculator.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(calculator.locator('[data-tessera-status="calculator"]')).toHaveText("paused");
  await calculator.scrollIntoViewIfNeeded();
  await expect(calculator.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await expect(page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount")).toHaveValue("48");
});

test("one rejected artifact leaves neighboring Tesserae available", async ({ page }) => {
  await page.route("**/assets/showcase/calculator.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto("/showcase");
  await expect(page.locator('[data-tessera-status="calculator"]')).toContainText("Interactive startup failed");
  await expect(page.locator('[data-showcase-card="calculator"]')).toContainText("57.6");
  const chart = page.locator('[data-showcase-card="chart"]');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator('[data-tessera-status="chart"]')).toHaveText("running");
});

for (const kind of ["infinite-loop", "stack-overflow", "trap", "rapid-allocation"] as const) {
  test(`hostile ${kind} is terminated without disturbing neighbors`, async ({ page }) => {
    await routeHostileCalculator(page, kind);
    await page.goto("/showcase");
    await expect(page.locator('[data-tessera-status="calculator"]')).toContainText(/Failed safely|startup failed/);
    await expect(page.locator('[data-showcase-card="calculator"]')).toContainText("57.6");
    const chart = page.locator('[data-showcase-card="chart"]');
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator('[data-tessera-status="chart"]')).toHaveText("running");
    if (kind === "trap") {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.locator('[data-showcase-card="calculator"]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-tessera-status="calculator"]')).toContainText(/Failed safely|startup failed/);
    }
  });
}

test("immediate input bursts are coalesced within the queue budget", async ({ page }) => {
  await page.goto("/showcase");
  const card = page.locator('[data-showcase-card="calculator"]');
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  const input = page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount");
  await input.evaluate((element) => {
    for (let value = 1; value <= 250; value += 1) {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(1_500);
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await expect(input).toBeVisible();
});

test("oversized input is contained inside the renderer port", async ({ page }) => {
  await page.goto("/showcase");
  const card = page.locator('[data-showcase-card="calculator"]');
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  const input = page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount");
  await input.evaluate((element) => {
    const control = element as HTMLInputElement;
    control.type = "text";
    control.value = "1".repeat(300_000);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(card.locator('[data-tessera-status="calculator"]')).toContainText(/Failed safely|startup failed/);
  await expect(page.locator('[data-tessera-status="chart"]')).not.toContainText(/failed/i);
});

test("freeze during an in-flight event cancels stale replies and resumes cleanly", async ({ page }) => {
  await page.goto("/showcase");
  const card = page.locator('[data-showcase-card="calculator"]');
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  const input = page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount");
  await input.evaluate((element) => {
    (element as HTMLInputElement).value = "100";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => document.dispatchEvent(new Event("freeze")));
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("paused");
  await page.evaluate(() => document.dispatchEvent(new Event("resume")));
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await expect(page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount")).toHaveValue("48");
});

test("non-persisted page disposal tears down renderers and restores fallbacks", async ({ page }) => {
  await page.goto("/showcase");
  await expect(page.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('[data-showcase-card="calculator"]')).toContainText("57.6");
});

test("global and cross-Tessera protocol spoofing is ignored", async ({ page }) => {
  await page.goto("/showcase");
  const calculator = page.locator('[data-showcase-card="calculator"]');
  await expect(calculator.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await page.evaluate(() => {
    window.postMessage({ version: 1, kind: "rendered", requestId: 1 }, "*");
    window.postMessage({ version: 1, tesseraId: "another-tessera", generation: 1, requestId: 1, kind: "runtime_error" }, "*");
  });
  await expect(calculator.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await expect(page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount")).toHaveValue("48");
});

test("keyboard focus and repeated restart remain deterministic", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/showcase");
  const card = page.locator('[data-showcase-card="calculator"]');
  await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  const frame = page.frameLocator('[data-showcase-card="calculator"] iframe');
  await page.locator('[data-showcase-card="calculator"] iframe').focus();
  await page.keyboard.press("Tab");
  await expect(frame.getByLabel("Bill amount")).toBeFocused();
  await expect.poll(() => frame.locator("body").evaluate(() => document.getAnimations().length)).toBe(0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await card.getByRole("button", { name: "Reset" }).click();
    await expect(card.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  }
});

test.describe("static and responsive behavior", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test("meaningful non-focusable app fallbacks render without script", async ({ page }) => {
    await page.goto("/showcase");
    await expect(page.getByRole("region", { name: "Tip calculator" })).toContainText("57.6");
    await expect(page.getByRole("figure", { name: "Value over four periods" })).toContainText("1.728");
    await expect(page.getByRole("region", { name: "Bounded simulation" })).toContainText("step 0");
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect.poll(() => page.locator('[data-showcase-card="chart"] svg').evaluate((svg) => svg.namespaceURI)).toBe("http://www.w3.org/2000/svg");
  });
});
