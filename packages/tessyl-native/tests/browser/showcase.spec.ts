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

test("five STEM Tesserae start independently and remain accessible", async ({ page }) => {
  await page.goto("/showcase");
  for (const id of ["calculator", "chart", "simulation", "orbital-simulation", "mathematical-diagram"]) {
    const card = page.locator(`[data-showcase-card="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(`[data-tessera-status="${id}"]`)).toHaveText("running");
    await expect(card.locator("iframe")).toHaveCount(1);
    await expect(card.locator("[data-tessyl-native-shell]")).toHaveCount(1);
  }
  await expect(page.locator('[data-showcase-card="simulation"] iframe')).toHaveAttribute("data-tessyl-expanded-view", "false");
  await expect(page.locator('[data-showcase-card="calculator"] iframe')).toHaveAttribute("data-tessyl-expanded-view", "false");
  const calculator = page.frameLocator('[data-showcase-card="calculator"] iframe');
  await page.locator('[data-showcase-card="calculator"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-tessera-status="calculator"]')).toHaveText("running");
  await expect(calculator.getByRole("heading", { name: "Scientific calculator" })).toBeVisible();
  await expect(calculator.locator("math")).toHaveCount(2);
  await expect(calculator.getByLabel("Kinetic energy", { exact: true })).toContainText("9.000");
  const velocity = calculator.getByLabel("Velocity");
  await velocity.fill("4");
  await expect(calculator.getByLabel("Kinetic energy", { exact: true })).toContainText("16.000");
  await expect(calculator.getByLabel("Integral of x squared", { exact: true })).toContainText(/21\.33/);
  const bill = calculator.getByLabel("Bill amount");
  await bill.click();
  await bill.press("ControlOrMeta+A");
  await bill.pressSequentially("100", { delay: 20 });
  await expect(bill).toBeFocused();
  await expect(calculator.getByLabel("Total", { exact: true })).toContainText("150");
  const chart = page.frameLocator('[data-showcase-card="chart"] iframe');
  await expect(chart.getByRole("figure", { name: "Value over four periods" })).toBeVisible();
  await expect(chart.getByRole("table", { name: "View chart data" })).toBeVisible();
  await expect(chart.getByRole("list", { name: "Legend" })).toContainText("Compounded");
  await expect(chart.getByRole("list", { name: "Legend" })).toContainText("Baseline");
  await expect(chart.getByText(/Pinned data:/)).toContainText('{"periods":[0,1,2,3]}');
  await expect(chart.getByText(/Deep-link state:/)).toContainText("growth=1.2");
  await expect(chart.getByRole("img", { name: "Reviewed teal growth badge" })).toBeVisible();
  await expect(chart.locator('polyline[data-native-series="solid"]')).toHaveCount(1);
  await expect(chart.locator('polyline[data-native-series="dashed"]')).toHaveCount(1);
  expect(await chart.getByRole("figure", { name: "Value over four periods" }).locator("svg").evaluate((element) => getComputedStyle(element).touchAction)).toBe("auto");
  const slider = chart.getByLabel("Growth factor");
  await slider.focus();
  await expect(slider).toBeFocused();
  const initialValue = await slider.inputValue();
  const box = await slider.boundingBox();
  if (!box) throw new Error("growth slider has no layout box");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(slider).not.toHaveValue(initialValue);
  await expect(page.locator("html")).toHaveAttribute("data-last-shareable-state", /.+/);
  await page.getByRole("button", { name: "Export reviewed snapshot" }).click();
  await expect(page.locator('[data-tessera-export-status="chart"]')).toContainText("Export ready: text/html");
  await expect(page.locator('[data-tessera-export-status="chart"]')).toHaveAttribute("data-tessera-export-text", /Revision growth-r2[\s\S]*Assumptions[\s\S]*source [a-f0-9]{64}/);
  const chartCard = page.locator('[data-showcase-card="chart"]');
  await chartCard.getByRole("button", { name: "Source" }).click();
  await expect(page.getByRole("dialog", { name: "Tessera source" })).toContainText("main.voyd");
  await page.getByRole("dialog", { name: "Tessera source" }).getByRole("button", { name: "Close" }).click();
  await chartCard.getByRole("button", { name: "Revision and provenance" }).click();
  await expect(page.getByRole("dialog", { name: "Revision and provenance" })).toContainText("growth_scenarios");
  await page.getByRole("dialog", { name: "Revision and provenance" }).getByRole("button", { name: "Close" }).click();
  await chartCard.getByRole("button", { name: "Reset" }).click();
  await expect(chartCard.locator('[data-tessera-status="chart"]')).toHaveText("running");
  await expect(page.locator("html")).toHaveAttribute("data-last-shareable-state", "growth=1.2");
  await expect(chart.getByText(/Deep-link state:/)).toContainText("growth=1.2");
  const particle = page.frameLocator('[data-showcase-card="simulation"] iframe');
  await expect(particle.getByRole("img", { name: /deterministic particles/i })).toBeVisible();
  await expect(particle.locator("canvas[data-native-particles]")).toHaveCount(1);
  const bufferedParticles = await particle.locator("[data-native-particle-buffer]").evaluateAll((buffers) => buffers.reduce((total, buffer) => total + (buffer.getAttribute("data-native-particle-buffer")?.split(";").filter(Boolean).length ?? 0), 0));
  expect(bufferedParticles).toBe(240);
  await expect(particle.locator("[data-native-particle]")).toHaveCount(0);
  await expect(particle.getByRole("list", { name: "Particle data" })).toContainText("Particle A");
  const orbitalCard = page.locator('[data-showcase-card="orbital-simulation"]');
  await orbitalCard.scrollIntoViewIfNeeded();
  await expect(orbitalCard.locator('[data-tessera-status="orbital-simulation"]')).toHaveText("running");
  const orbit = page.frameLocator('[data-showcase-card="orbital-simulation"] iframe');
  const orbitalScene = orbit.getByRole("application", { name: /Sun is centered/i });
  await orbitalScene.focus();
  await orbitalScene.press("ArrowRight");
  await expect(orbitalScene).toBeFocused();
  expect(await orbitalScene.evaluate((element) => !element.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true, cancelable: true })))).toBe(true);
  await orbitalScene.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 17, buttons: 1, clientX: bounds.right + 500, clientY: bounds.bottom + 500, bubbles: true }));
  });
  await expect.poll(async () => orbit.locator('[aria-label="Earth"]').evaluate((element) => {
    const points = (element.getAttribute("points") ?? "").trim().split(/\s+/).map((point) => point.split(",").map(Number));
    const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / points.length);
    return center.every((value) => value >= -0.000001 && value <= 100.000001);
  })).toBe(true);
  await orbit.getByRole("application", { name: /Sun is centered/i }).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent("pointerup", { pointerId: 17, clientX: bounds.right + 500, clientY: bounds.bottom + 500, bubbles: true }));
  });
  await expect(orbit.getByLabel("Simulation speed")).toBeVisible();
  await expect(orbit.getByRole("button", { name: "Replay seed 42" })).toBeVisible();
  const diagram = page.frameLocator('[data-showcase-card="mathematical-diagram"] iframe');
  const interactive = diagram.getByRole("application", { name: /movable vector endpoint/i });
  expect(await interactive.evaluate((element) => getComputedStyle(element).touchAction)).toBe("none");
  await interactive.hover();
  await expect(diagram.getByText("Interaction state: Pointer hovering")).toBeVisible();
  await interactive.focus();
  await expect(diagram.getByText("Interaction state: Diagram focused")).toBeVisible();
  await interactive.press("ArrowRight");
  await expect(interactive).toBeFocused();
  const simulation = page.locator('[data-showcase-card="simulation"]');
  const expanded = simulation.getByRole("button", { name: "Expanded view" });
  await expanded.click();
  await expect(simulation.locator('[data-tessyl-native-shell]')).toHaveAttribute("role", "dialog");
  await page.keyboard.press("Escape");
  await expect(simulation.locator('[data-tessyl-native-shell]')).toHaveAttribute("role", "region");
  await expect(expanded).toBeFocused();
});

test("live reduced-motion changes pause and resume fixed-step simulation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/showcase");
  const card = page.locator('[data-showcase-card="simulation"]');
  await expect.poll(async () => {
    await card.scrollIntoViewIfNeeded();
    return card.locator('[data-tessera-status="simulation"]').textContent();
  }).toBe("running");
  const simulation = page.frameLocator('[data-showcase-card="simulation"] iframe');
  const step = simulation.getByLabel("Step", { exact: true });
  const animationFrame = simulation.getByLabel("Animation frame", { exact: true });
  await simulation.getByRole("button", { name: "Run" }).click();
  await expect(step).not.toContainText(/^Step\s*0$/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(400);
  await expect(card.locator("[data-tessyl-native-failure-code]")).toHaveCount(0);
  const paused = await step.textContent();
  await page.waitForTimeout(250);
  await expect(step).toHaveText(paused ?? "");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(step).not.toHaveText(paused ?? "");
  await simulation.getByRole("button", { name: "Pause" }).click();
  await expect(simulation.getByRole("button", { name: "Run" })).toBeVisible();
  const manuallyPaused = await step.textContent();
  const pausedAnimationFrame = await animationFrame.textContent();
  await page.waitForTimeout(250);
  await expect(step).toHaveText(manuallyPaused ?? "");
  await expect(animationFrame).toHaveText(pausedAnimationFrame ?? "");
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
  await expect.poll(async () => {
    await calculator.scrollIntoViewIfNeeded();
    return calculator.locator('[data-tessera-status="calculator"]').textContent();
  }).toBe("running");
  await expect(page.frameLocator('[data-showcase-card="calculator"] iframe').getByLabel("Bill amount")).toHaveValue("48");
});

test("one rejected artifact leaves neighboring Tesserae available", async ({ page }) => {
  await page.route("**/assets/showcase/calculator.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto("/showcase");
  await expect(page.locator('[data-tessera-status="calculator"]')).toContainText("Interactive startup failed");
  const rejectedCard = page.locator('[data-showcase-card="calculator"]');
  await expect(rejectedCard).toContainText("57.6");
  await expect(rejectedCard).toContainText("Revision calculator-r3");
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
  const disposedCard = page.locator('[data-showcase-card="calculator"]');
  await expect(disposedCard).toContainText("72");
  await expect(disposedCard).toContainText("Revision calculator-r3");
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
  await frame.getByLabel("Mass").focus();
  await expect(frame.getByLabel("Mass")).toBeFocused();
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
    await expect(page.getByRole("region", { name: "Scientific calculator" })).toContainText("57.6");
    await expect(page.getByRole("figure", { name: "Value over four periods" })).toContainText("1.728");
    await expect(page.getByRole("region", { name: "Growth chart and scenario matrix" })).toContainText("Assumptions");
    await expect(page.getByRole("region", { name: "Growth chart and scenario matrix" })).toContainText("Revision growth-r2");
    await expect(page.getByRole("region", { name: "Bounded particle simulation" })).toContainText(/Step\s*0/i);
    await expect(page.getByRole("region", { name: "Interactive Sun and Earth orbital model" })).toContainText("Sun and Earth model");
    await expect(page.getByRole("region", { name: "Interactive vector decomposition diagram" })).toContainText("Vector decomposition diagram");
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect.poll(() => page.locator('[data-showcase-card="chart"] svg').first().evaluate((svg) => svg.namespaceURI)).toBe("http://www.w3.org/2000/svg");
  });
});
