// Small helpers the takes share.
import type { Locator, Page } from "playwright-core";
import { VIEWPORT } from "../app.ts";
import type { Take } from "../director.ts";

/** Centre of `target` as fractions of the frame, for callouts and zooms. */
export async function fraction(page: Page, target: Locator): Promise<[number, number]> {
  const box = await target.boundingBox();
  if (!box) throw new Error("Target has no box");
  const size = page.viewportSize() ?? VIEWPORT;
  return [(box.x + box.width / 2) / size.width, (box.y + box.height / 2) / size.height];
}

/** Points a callout at `target`. */
export async function callout(t: Take, target: Locator, text: string, seconds = 3) {
  const [x, y] = await fraction(t.page, target);
  t.callout(text, x, y, seconds);
}

/** Zooms the edit towards `target` for `seconds`. */
export async function zoomTo(t: Take, target: Locator, seconds: number, zoom = 1.5) {
  t.zoom(await fraction(t.page, target), seconds, zoom);
}

/** Hides the console dock so the graph gets the room. */
export async function hideConsole(page: Page) {
  if (await page.locator(".console-dock").isVisible()) await page.getByTitle("Toggle console").click();
}

/** Opens the console dock on camera, retrying once if the first click is swallowed. */
export async function showConsole(t: Take) {
  for (let i = 0; i < 2 && !(await t.page.locator(".console-dock").isVisible()); i++) {
    await t.click(t.page.getByTitle("Toggle console"));
    await t.pause(0.5);
  }
}

export const row = (page: Page, message: string) => page.locator(".commit-row", { has: page.locator(".cr-message", { hasText: message }) }).first();
export const sidebarItem = (page: Page, label: string) => page.locator(".sb-item", { has: page.locator(".sb-item-label", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`) }) }).first();

/** Glides the cursor across several targets in turn, pausing on each. */
export async function sweep(t: Take, targets: Locator[], pause = 0.35) {
  for (const target of targets) {
    await t.moveTo(target, 450);
    await t.pause(pause);
  }
}
