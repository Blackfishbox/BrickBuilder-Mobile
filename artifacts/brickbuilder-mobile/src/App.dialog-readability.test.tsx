// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import App from "./App";
import { I18nProvider, LANGUAGE_STORAGE_KEY } from "@/i18n/I18nProvider";
import { createEmptyDocument } from "@/features/editor/model";
import { GESTURE_GUIDE_SECTIONS, HELP_BUTTON_SECTIONS, HELP_MODE_OVERVIEW } from "@/features/engine/gesture-guide";
import { parseInventory } from "@/features/inventory/import";
import { COLOR_THEME_STORAGE_KEY } from "@/platform/color-theme";
import { setRemoteGeometryEnabled } from "@/features/privacy/geometry-consent";
const premium = vi.hoisted(() => ({ active: false, status: "ready" }));
vi.mock("@/features/premium/usePremium", () => ({ usePremium: () => premium }));

const darkThemeCss = readFileSync("src/dark-theme.css", "utf8");
const editorCss = readFileSync("src/components/mobile/editor.css", "utf8");
const brandCss = readFileSync("src/brand-theme.css", "utf8");
const themeCss = readFileSync("src/index.css", "utf8");
const formatDialogCss = readFileSync("src/features/formats/format-dialog.css", "utf8");
const storageManagerCss = readFileSync("src/features/storage/storage-manager.css", "utf8");

const { editor, getStorageOverview, canvasProps } = vi.hoisted(() => ({
  editor: {} as Record<string, any>,
  getStorageOverview: vi.fn(),
  canvasProps: { current: {} as Record<string, any> },
}));

vi.mock("@/features/editor/useBuilder", () => ({ useBuilder: () => editor }));
vi.mock("@/features/catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }),
  resolveStoredInventory: async (inventory: { rows: { id: string; partId: string; colorId: string }[] }) => ({
    inventory,
    resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: row.partId, name: `Teil ${row.partId}` }],
      colors: [{ ldrawCode: row.colorId, name: `Farbe ${row.colorId}`, hex: "#b40000" }],
    }])),
  }),
  previewInventory: vi.fn(),
}));
vi.mock("@/features/engine/BuilderCanvas", () => ({
  default: (props: { showConstructionControls?: boolean; [key: string]: any }) => {
    canvasProps.current = props;
    return <div data-testid="mock-canvas" data-construction-controls={String(props.showConstructionControls)}
      onPointerDown={() => props.onSelect?.(null)} />;
  },
}));
vi.mock("@/features/parts/PartsLibrary", () => ({
  default: (props: { selectedPartId?: string }) => <div><input aria-label="Search parts" />
    {!props.selectedPartId && <button type="button" data-testid="mock-part-choice">Choose part</button>}
  </div>,
}));
vi.mock("@/features/catalog/EvidencedColorPicker", () => ({
  default: (props: { mobile?: boolean; onChange?: (color: { value: string; ldrawCode: string }) => void }) => <>
    {props.mobile && <input type="search" data-testid="color-search" aria-label="Search colors" />}
    <button type="button" data-testid={props.mobile ? "mobile-color-option" : "mock-color-picker"}
      onClick={() => props.onChange?.({ value: "#112233", ldrawCode: "1" })}>Farbauswahl</button>
  </>,
}));
vi.mock("@/features/inventory/InventoryThumbnail", () => ({ default: () => <div aria-hidden="true" /> }));
vi.mock("@/storage/management", () => ({
  getStorageOverview,
  removeGeometrySnapshot: vi.fn(),
  removeInstalledPackage: vi.fn(),
  removeStoredProject: vi.fn(),
}));
vi.mock("@/storage/database", () => ({ loadProject: vi.fn() }));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let textScaleStyle: HTMLStyleElement | undefined;
let oldWidth: number;
let oldHeight: number;

afterEach(() => {
  premium.active = false; premium.status = "ready";
  if (root) act(() => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  textScaleStyle?.remove();
  textScaleStyle = undefined;
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  canvasProps.current = {};
  Object.defineProperty(window, "innerWidth", { configurable: true, value: oldWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: oldHeight });
});

async function mount(
  theme: "light" | "dark",
  withSelection = false,
  language: "en" | "de" = "de",
  options: {
    viewport?: { width: number; height: number };
    projects?: { id: string; name: string; brickCount: number }[];
  } = {},
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  oldWidth = window.innerWidth;
  oldHeight = window.innerHeight;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: options.viewport?.width ?? 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: options.viewport?.height ?? 844 });
  localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);

  const document = createEmptyDocument("Mobile-Dialoge");
  if (withSelection) {
    document.bricks = [
      { id: "selected-brick", type: "brick-2x2", color: "#d75b3f", x: 0, y: 0, z: 0, rotation: 0 },
      { id: "second-brick", type: "brick-1x2", color: "#1e5aa8", x: 4, y: 0, z: 0, rotation: 0 },
    ];
  }
  document.inventory = parseInventory("part_id,color_id,quantity\n3001,5,2", "mobile.csv");
  Object.assign(editor, {
    isReady: true,
    document,
    bricks: document.bricks,
    imported: undefined,
    selectedId: withSelection ? "selected-brick" : null,
    selectedInstance: null,
    selectedPart: null,
    selectedInventory: null,
    selectedType: "brick-2x4",
    selectedColor: "#d75b3f",
    selectedColorCode: "4",
    toolMode: withSelection ? "select" : "view",
    projectName: "Mobile-Dialoge",
    projects: options.projects ?? [],
    brickCount: 0,
    canUndo: false,
    canRedo: false,
    isSaving: false,
    savedAt: null,
    saveError: "",
    partLoading: false,
    partError: "",
    cancelPartPreparation: vi.fn(),
    changeHeight: vi.fn(),
    deleteSelected: vi.fn(),
    importProject: vi.fn(),
    move: vi.fn(),
    nudgeSelected: vi.fn(),
    openProject: vi.fn(),
    place: vi.fn(),
    redo: vi.fn(),
    refreshProjects: vi.fn().mockResolvedValue([]),
    rotateSelected: vi.fn(),
    save: vi.fn(),
    select: vi.fn(),
    selectInventoryPart: vi.fn(),
    selectLibraryPart: vi.fn(),
    setInstructionPlan: vi.fn(),
    setProjectName: vi.fn(),
    setSelectedColor: vi.fn(),
    setToolMode: vi.fn(),
    startNewProject: vi.fn(),
    undo: vi.fn(),
    replacePartsInventory: vi.fn(),
  });
  getStorageOverview.mockResolvedValue({
    browser: { usage: 4096, quota: 8192 },
    projects: [
      { id: "current-project", name: "Geöffnetes Modell", bytes: 1024, detail: "1 Stein" },
      { id: "older-project", name: "Früheres Modell", bytes: 2048, detail: "2 Steine" },
    ],
    packages: [{ id: "parts-package", name: "Teilepaket", bytes: 512, detail: "1 Teil · 1 Datei" }],
    snapshots: [{ id: "snapshot", name: "3001.dat", bytes: 128, detail: "1 Datei" }],
  });

  host = documentRef.createElement("div");
  documentRef.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(documentRef.documentElement.classList.contains("dark")).toBe(theme === "dark");
  expect(documentRef.documentElement.style.colorScheme).toBe(theme);
  return host;
}

const documentRef = globalThis.document;

function cssRule(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "g"))];
  expect(matches.length, `Expected a CSS rule for ${selector}`).toBeGreaterThan(0);
  return matches.reduce<Record<string, string>>((declarations, match) => {
    for (const [, property, value] of match[1].matchAll(/([a-z-]+)\s*:\s*([^;]+);?/g)) {
      declarations[property] = value.trim();
    }
    return declarations;
  }, {});
}

it.each(["de", "en"] as const)("shows an icon-only language menu beside the theme button in %s", async language => {
  const container = await mount("light", false, language);
  const theme = container.querySelector<HTMLButtonElement>('[data-testid="button-toggle-theme"]')!;
  const languageButton = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;
  const languageControl = container.querySelector<HTMLElement>(".language-menu")!;
  const headerControls = [...container.querySelector<HTMLElement>(".topbar-end")!.children];
  expect(languageButton.getAttribute("aria-label")).toBe(language === "de" ? "Sprache" : "Language");
  expect(languageButton.getAttribute("aria-haspopup")).toBe("menu");
  expect(languageButton.textContent?.trim()).toBe("");
  expect(languageButton.querySelector("svg")).not.toBeNull();
  expect(headerControls.indexOf(languageControl)).toBe(headerControls.indexOf(theme) + 1);
  expect(container.querySelector('[role="menu"]')).toBeNull();

  await act(async () => languageButton.click());
  const dropdown = container.querySelector<HTMLElement>('[role="menu"]')!;
  expect(dropdown.closest('[role="dialog"]')).toBeNull();
  expect(dropdown.querySelector('[data-testid="language-option-en"]')?.textContent).toBe(language === "de" ? "Englisch" : "English");
  expect(dropdown.querySelector('[data-testid="language-option-de"]')?.textContent).toBe(language === "de" ? "Deutsch" : "German");
  expect(dropdown.querySelector(`[data-testid="language-option-${language}"]`)?.getAttribute("aria-checked")).toBe("true");
  await act(async () => languageButton.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
  const menu = container.querySelector<HTMLElement>(".project-popover")!;
  expect(menu.querySelector(".popover-eyebrow")).toBeNull();
  for (const icon of menu.querySelectorAll(".popover-action svg")) {
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  }
  expect(menu.querySelector('[data-testid="select-language"]')).toBeNull();
  expect(editorCss).toMatch(/\.popover-action\s*\{[^}]*min-height: 48px/);
  expect(editorCss).toMatch(/\.popover-action\s*\{[^}]*font-size: 14px/);
  expect(editorCss).toContain(".language-dropdown");
  expect(brandCss).toContain("max-width: calc(100vw - 24px)");
});

it.each(["de", "en"] as const)("focuses the selected language option when the menu opens in %s", async language => {
  const container = await mount("light", false, language);
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;

  await act(async () => trigger.click());

  const selectedOption = container.querySelector<HTMLButtonElement>(`[data-testid="language-option-${language}"]`);
  expect(selectedOption).not.toBeNull();
  expect(document.activeElement).toBe(selectedOption);
});

it.each(["de", "en"] as const)("supports language menu keys from both options in %s", async language => {
  const container = await mount("light", false, language);
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;
  await act(async () => trigger.click());

  const keyCases = [
    { from: "en", key: "ArrowDown", to: "de" },
    { from: "en", key: "ArrowUp", to: "de" },
    { from: "en", key: "Home", to: "en" },
    { from: "en", key: "End", to: "de" },
    { from: "de", key: "ArrowDown", to: "en" },
    { from: "de", key: "ArrowUp", to: "en" },
    { from: "de", key: "Home", to: "en" },
    { from: "de", key: "End", to: "de" },
  ] as const;

  for (const { from, key, to } of keyCases) {
    const startingOption = container.querySelector<HTMLButtonElement>(`[data-testid="language-option-${from}"]`)!;
    const expectedOption = container.querySelector<HTMLButtonElement>(`[data-testid="language-option-${to}"]`)!;
    startingOption.focus();
    await act(async () => {
      startingOption.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    expect(document.activeElement, `${language} locale, ${key} from ${from}`).toBe(expectedOption);
  }
});

it.each([
  ["Enter", "de"],
  ["Enter", "en"],
  [" ", "de"],
  [" ", "en"],
] as const)("selects the focused language with %s in %s", async (key, language) => {
  const container = await mount("light", false, language);
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;
  await act(async () => trigger.click());

  const targetLanguage = language === "en" ? "de" : "en";
  const targetOption = container.querySelector<HTMLButtonElement>(`[data-testid="language-option-${targetLanguage}"]`)!;
  targetOption.focus();
  await act(async () => {
    targetOption.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

  expect(documentRef.documentElement.lang).toBe(targetLanguage);
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(targetLanguage);
  expect(container.querySelector('[role="menu"]')).toBeNull();
});

it.each([
  { screen: "320px-wide screen", width: 320, height: 568 },
  { screen: "short landscape screen", width: 568, height: 320 },
])("keeps the project menu scrollable and within the screen at 200% text size on a $screen", async ({ width, height }) => {
  const lastProjectName = "Zuletzt gespeichertes Modell mit langem Namen";
  const container = await mount("light", false, "de", {
    viewport: { width, height },
    projects: Array.from({ length: 8 }, (_, index) => ({
      id: `saved-project-${index}`,
      name: index === 7 ? lastProjectName : `Gespeichertes Modell ${index + 1}`,
      brickCount: index + 1,
    })),
  });

  textScaleStyle = documentRef.createElement("style");
  textScaleStyle.textContent = "html { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }";
  documentRef.head.appendChild(textScaleStyle);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());

  const menu = container.querySelector<HTMLElement>(".project-popover")!;
  const language = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]');
  const lastProject = menu.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved-project-7"]')!;
  const menuSizing = cssRule(editorCss, ".project-popover");
  const brandSizing = cssRule(brandCss, ".project-popover");
  const savedProjectText = cssRule(editorCss, ".saved-project span");

  expect(textScaleStyle.textContent).toContain("text-size-adjust: 200%");
  expect(language).not.toBeNull();
  expect(menu.querySelector('[data-testid="select-language"]')).toBeNull();
  expect(lastProject.textContent).toContain(lastProjectName);
  expect(menuSizing.width).toBe("min(290px, calc(100vw - 28px))");
  expect(brandSizing["max-width"]).toBe("calc(100vw - 24px)");
  expect(brandSizing["max-height"]).toBe("min(76dvh, 680px)");
  expect(menuSizing["overflow-y"]).toBe("auto");
  expect(savedProjectText.overflow).toBe("hidden");
  expect(savedProjectText["text-overflow"]).toBe("ellipsis");
  expect(savedProjectText["white-space"]).toBe("nowrap");
});

it("keeps an empty project-name draft while editing and saves the replacement on blur", async () => {
  const container = await mount("light");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
  const input = container.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!;
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

  await act(async () => input.focus());
  await act(async () => {
    valueSetter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.value).toBe("");
  expect(editor.setProjectName).not.toHaveBeenCalled();

  await act(async () => {
    valueSetter.call(input, "Neuer Entwurf");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });
  expect(editor.setProjectName).toHaveBeenCalledWith("Neuer Entwurf");
});

it("does not accept a blank project name when editing ends", async () => {
  const container = await mount("light");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
  const input = container.querySelector<HTMLInputElement>('[data-testid="input-project-name"]')!;
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

  await act(async () => input.focus());
  await act(async () => {
    valueSetter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.value).toBe("");

  await act(async () => input.blur());
  expect(editor.setProjectName).not.toHaveBeenCalled();
  expect(input.value).toBe("Mobile-Dialoge");
});

it("keeps keyboard focus visible through the project menu at 200% text size on a short mobile screen", async () => {
  const container = await mount("light", false, "en", {
    viewport: { width: 320, height: 280 },
    projects: Array.from({ length: 8 }, (_, index) => ({
      id: `keyboard-project-${index}`,
      name: `Saved model ${index + 1}`,
      brickCount: index + 1,
    })),
  });
  textScaleStyle = documentRef.createElement("style");
  textScaleStyle.textContent = "html { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }";
  documentRef.head.appendChild(textScaleStyle);

  const opener = container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!;
  opener.focus();
  await act(async () => opener.click());
  const menu = container.querySelector<HTMLElement>("#project-menu")!;
  const focusableControls = [...menu.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])")];
  const lastProject = menu.querySelector<HTMLButtonElement>('[data-testid="button-open-project-keyboard-project-7"]')!;
  const scrollIntoView = vi.fn();
  lastProject.scrollIntoView = scrollIntoView;

  expect(focusableControls.length).toBeGreaterThan(10);
  for (const control of focusableControls) {
    control.focus();
    expect(documentRef.activeElement).toBe(control);
  }
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  expect(editorCss).toMatch(/\.project-popover\s*\{[^}]*overflow-y:\s*auto/);
  expect(editorCss).toMatch(/\.project-popover\s*\{[^}]*overscroll-behavior-y:\s*contain/);

  await act(async () => {
    lastProject.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  expect(container.querySelector("#project-menu")).toBeNull();
  expect(documentRef.activeElement).toBe(opener);
});

it("shows the menu icon instead of the colored dot in the main menu button", async () => {
  const container = await mount("light");
  const menuButton = container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!;

  expect(menuButton.querySelector(".project-dot")).toBeNull();
  expect(menuButton.querySelector("svg")).not.toBeNull();
});

it("keeps keyboard focus visible in the parts drawer and restores its opener on Escape", async () => {
  const container = await mount("light", false, "en", { viewport: { width: 320, height: 280 } });
  textScaleStyle = documentRef.createElement("style");
  textScaleStyle.textContent = "html { -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }";
  documentRef.head.appendChild(textScaleStyle);

  const opener = container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-parts"]')!;
  opener.focus();
  await act(async () => opener.click());
  const drawer = container.querySelector<HTMLElement>('[data-testid="drawer-parts"]')!;
  const closeButton = drawer.querySelector<HTMLButtonElement>('[data-testid="button-close-parts"]')!;
  const catalogTab = drawer.querySelector<HTMLButtonElement>('[data-testid="tab-ldraw"]')!;
  const inventoryTab = drawer.querySelector<HTMLButtonElement>('[data-testid="tab-inventory"]')!;
  const search = drawer.querySelector<HTMLInputElement>('[aria-label="Search parts"]')!;
  const partChoice = drawer.querySelector<HTMLButtonElement>('[data-testid="mock-part-choice"]')!;
  const tabStops = [closeButton, catalogTab, search, partChoice];
  const scrollIntoView = vi.fn();
  for (const control of tabStops) control.scrollIntoView = scrollIntoView;

  expect(documentRef.activeElement).toBe(catalogTab);
  expect(catalogTab.tabIndex).toBe(0);
  expect(inventoryTab.tabIndex).toBe(-1);
  for (const control of tabStops) {
    control.focus();
    expect(documentRef.activeElement).toBe(control);
  }
  const disabledControl = documentRef.createElement("button");
  disabledControl.disabled = true;
  drawer.appendChild(disabledControl);
  closeButton.focus();
  const shiftFromFirst = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => closeButton.dispatchEvent(shiftFromFirst));
  expect(shiftFromFirst.defaultPrevented).toBe(true);
  expect(documentRef.activeElement).toBe(partChoice);
  partChoice.focus();
  const tabFromLast = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => partChoice.dispatchEvent(tabFromLast));
  expect(tabFromLast.defaultPrevented).toBe(true);
  expect(documentRef.activeElement).toBe(closeButton);

  opener.focus();
  const shiftFromOutside = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => opener.dispatchEvent(shiftFromOutside));
  expect(shiftFromOutside.defaultPrevented).toBe(true);
  expect(documentRef.activeElement).toBe(partChoice);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  expect(editorCss).toMatch(/\.parts-drawer\s*\{[^}]*max-height:\s*min\(86dvh,\s*720px\)/);
  expect(editorCss).toMatch(/\.parts-drawer\s*\{[^}]*overflow:\s*auto/);
  expect(editorCss).toMatch(/\.parts-drawer :is\([^}]*\):focus\s*\{[^}]*scroll-margin-block:\s*12px/);

  await act(async () => {
    partChoice.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  expect(container.querySelector('[data-testid="drawer-parts"]')).toBeNull();
  expect(documentRef.activeElement).toBe(opener);
});

it("focuses the color search and restores its opener after Escape", async () => {
  const container = await mount("light", false, "en", { viewport: { width: 320, height: 280 } });
  const opener = container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-colors"]')!;
  opener.focus();
  await act(async () => opener.click());

  const drawer = container.querySelector<HTMLElement>('[data-testid="drawer-colors"]')!;
  const search = drawer.querySelector<HTMLInputElement>('[data-testid="color-search"]')!;
  const colorOption = drawer.querySelector<HTMLButtonElement>('[data-testid="mobile-color-option"]')!;
  const scrollIntoView = vi.fn();
  colorOption.scrollIntoView = scrollIntoView;

  expect(documentRef.activeElement).toBe(search);
  colorOption.focus();
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  expect(editorCss).toMatch(/\.color-drawer\s*\{[^}]*overflow-y:\s*auto/);
  expect(editorCss).toMatch(/\.color-drawer :is\([^}]*\):focus\s*\{[^}]*scroll-margin-block:\s*12px/);

  await act(async () => {
    colorOption.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  expect(container.querySelector('[data-testid="drawer-colors"]')).toBeNull();
  expect(documentRef.activeElement).toBe(opener);
});

it("returns focus to the color drawer opener after choosing a color", async () => {
  const container = await mount("light", false, "en");
  const opener = container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-colors"]')!;
  await act(async () => opener.click());
  const choice = container.querySelector<HTMLButtonElement>('[data-testid="mobile-color-option"]')!;

  await act(async () => choice.click());

  expect(container.querySelector('[data-testid="drawer-colors"]')).toBeNull();
  expect(documentRef.activeElement).toBe(opener);
});

it("returns focus to the parts drawer when a list update removes the focused part", async () => {
  const container = await mount("light", false, "en");
  const opener = container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-parts"]')!;
  await act(async () => opener.click());
  const drawer = container.querySelector<HTMLElement>('[data-testid="drawer-parts"]')!;
  const partChoice = drawer.querySelector<HTMLButtonElement>('[data-testid="mock-part-choice"]')!;
  const catalogTab = drawer.querySelector<HTMLButtonElement>('[data-testid="tab-ldraw"]')!;
  partChoice.focus();
  expect(documentRef.activeElement).toBe(partChoice);

  editor.selectedPart = { ldrawId: "3001.dat" };
  await act(async () => root!.render(<I18nProvider><App /></I18nProvider>));

  expect(drawer.querySelector('[data-testid="mock-part-choice"]')).toBeNull();
  expect(documentRef.activeElement).toBe(catalogTab);
});

it.each(["light", "dark"] as const)("also verifies help examples in %s mode", async theme => {
  const container = await mount(theme, true);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  const edgeExample = dialog.querySelector(".thick-edges-sample")!;
  expect(edgeExample.outerHTML).toBe(container.querySelector('[data-testid="button-thick-edges"] .thick-edges-sample')!.outerHTML);
  const heightButtons = container.querySelectorAll<HTMLElement>(".mobile-selection-actions > button");
  expect(dialog.querySelector(".height-arrows")?.textContent).toBe(
    `${heightButtons[0]?.textContent} ${heightButtons[1]?.textContent}`,
  );
  expect(dialog.querySelector(".lucide-box, .lucide-panel-top, .lucide-folder-open")).toBeNull();
  const projects = dialog.querySelector(".gesture-guide-text-only")!;
  expect(projects.querySelector("svg")).toBeNull();
  expect(projects.textContent).toContain("Auf diesem Gerät");
});

it.each(["de", "en"] as const)("shows a larger project menu without the workshop heading in %s", async language => {
  const container = await mount("light", false, language);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
  const menu = container.querySelector<HTMLElement>(".project-popover")!;
  expect(menu.querySelector(".popover-eyebrow")).toBeNull();
  for (const icon of menu.querySelectorAll(".popover-action svg")) {
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  }
  expect(menu.querySelector(".language-row")).toBeNull();
  expect(menu.querySelector('[data-testid="button-language-menu"]')).toBeNull();
  expect(menu.querySelector('[data-testid="select-language"]')).toBeNull();
  const languageButton = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;
  expect(languageButton.getAttribute("aria-label")).toBe(language === "de" ? "Sprache" : "Language");
  expect(editorCss).toMatch(/\.popover-action\s*\{[^}]*min-height: 48px/);
  expect(editorCss).toMatch(/\.popover-action\s*\{[^}]*font-size: 14px/);
  expect(brandCss).toContain("max-width: calc(100vw - 24px)");
});

it.each(["light", "dark"] as const)("uses real arrow and edge symbols in %s help", async theme => {
  const container = await mount(theme);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  const edgeExample = dialog.querySelector(".thick-edges-sample")!;
  expect(edgeExample.outerHTML).toBe(container.querySelector('[data-testid="button-thick-edges"] .thick-edges-sample')!.outerHTML);
  expect(dialog.querySelector(".height-arrows")?.textContent).toBe("↑ ↓");
  expect(dialog.querySelector(".lucide-box, .lucide-panel-top, .lucide-folder-open")).toBeNull();
  const projects = dialog.querySelector(".gesture-guide-text-only")!;
  expect(projects.querySelector("svg")).toBeNull();
  expect(projects.textContent).toContain("Auf diesem Gerät");
});
it("uses logo orange rather than violet for secondary interface accents", () => {
  expect(brandCss).toContain("--brand-highlight: 27 95% 43%");
  expect(brandCss).toContain("--brand-highlight: 32 100% 64%");
  expect(themeCss).toContain("--secondary: 32 100% 92%");
  expect(themeCss).toContain("--secondary: 28 60% 28%");
  expect(themeCss).not.toMatch(/--(?:brand-highlight|secondary|chart-2):\s*(?:26[7-9]|27\d|28\d)\s/u);
});

it("switches to selection mode and selects a tapped part from the view canvas", async () => {
  await mount("light");
  const onViewPartTap = canvasProps.current.onViewPartTap as (id: string) => void;
  expect(onViewPartTap).toBeTypeOf("function");

  act(() => onViewPartTap("imported-part-17"));

  expect(editor.setToolMode).toHaveBeenCalledWith("select");
  expect(editor.select).toHaveBeenCalledWith("imported-part-17");
});

it("opens the English gesture guide from the header after theme and language", async () => {
  const container = await mount("light", false, "en");
  const headerControls = [...container.querySelector<HTMLElement>(".topbar-end")!.children];
  const helpButton = container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!;
  const languageControl = container.querySelector<HTMLElement>(".language-menu")!;
  expect(helpButton.getAttribute("aria-label")).toBe("Gesture help");
  expect(headerControls.indexOf(helpButton)).toBe(headerControls.indexOf(languageControl) + 1);
  expect(headerControls.indexOf(container.querySelector<HTMLButtonElement>('[data-testid="button-save"]')!))
    .toBe(headerControls.indexOf(helpButton) + 1);

  await act(async () => helpButton.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  expect(dialog.textContent).toContain("App guide: modes, buttons, and gestures");
  expect(dialog.textContent).toContain("Build mode");
  expect(dialog.textContent).toContain("Double-tap empty space");
  expect(dialog.textContent).toContain("Double-tap a rotation or tilt slider");
  expect(dialog.textContent).toContain("Move connected upper parts");
  expect(dialog.textContent).toContain("Import file");
  expect(dialog.textContent).toContain("Android: the export can continue in the background or with the screen off for up to two hours.");
  expect(dialog.querySelectorAll(".gesture-guide-button-visual").length).toBeGreaterThan(20);
  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(false);
});

it.each([
  { name: "a narrow phone", viewport: { width: 320, height: 280 } },
  { name: "a short landscape viewport", viewport: { width: 640, height: 360 } },
])("keeps every gesture guide section reachable on $name with enlarged text", async ({ viewport }) => {
  const container = await mount("light", false, "en", { viewport });
  textScaleStyle = documentRef.createElement("style");
  textScaleStyle.textContent = "html { font-size: 200%; -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }";
  documentRef.head.appendChild(textScaleStyle);

  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  const dialogSizing = cssRule(editorCss, ".gesture-guide-dialog");
  const scrollAreaSizing = cssRule(editorCss, ".gesture-guide-scroll-area");
  const titleSizing = cssRule(editorCss, ".gesture-guide-title");
  const descriptionSizing = cssRule(editorCss, ".gesture-guide-sections li p");
  const expectedSectionCount = 1 + HELP_BUTTON_SECTIONS.length + GESTURE_GUIDE_SECTIONS.length;
  const expectedGestureCount = GESTURE_GUIDE_SECTIONS.reduce((count, section) => count + section.gestures.length, 0);
  const shortLandscapeRule = editorCss.match(
    /@media \(orientation: landscape\) and \(max-height: 560px\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? "";

  expect(textScaleStyle.textContent).toContain("text-size-adjust: 200%");
  expect(dialogSizing["max-height"]).toBe("calc(100dvh - 24px)");
  expect(dialogSizing.overflow).toBe("hidden");
  expect(scrollAreaSizing["overflow-y"]).toBe("auto");
  expect(scrollAreaSizing["overscroll-behavior-y"]).toBe("contain");
  expect(titleSizing["font-size"]).toBe("1.25rem");
  expect(descriptionSizing["font-size"]).toBe(".75rem");
  expect(descriptionSizing["overflow-wrap"]).toBe("anywhere");
  expect(shortLandscapeRule).toContain(
    ".gesture-guide-modes,\n  .gesture-guide-buttons { grid-template-columns: minmax(0, 1fr); }",
  );
  expect(dialog.querySelectorAll(".gesture-guide-sections section")).toHaveLength(expectedSectionCount);
  expect(dialog.querySelectorAll(".gesture-guide-sections li")).toHaveLength(
    HELP_BUTTON_SECTIONS.reduce((count, section) => count + section.buttons.length, 0) + expectedGestureCount,
  );
  expect(dialog.textContent).toContain("Double-tap a rotation or tilt slider");
  expect(dialog.textContent).toContain("Android: the export can continue in the background or with the screen off for up to two hours.");
});

it("keeps format and storage dismiss controls visible on short screens with enlarged text", async () => {
  const container = await mount("light", false, "en", { viewport: { width: 320, height: 280 } });
  textScaleStyle = documentRef.createElement("style");
  textScaleStyle.textContent = "html { font-size: 200%; -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }";
  documentRef.head.appendChild(textScaleStyle);

  openProjectMenu(container);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-open-export"]')!.click());
  const formats = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-formats"]')!;
  const formatClose = formats.querySelector<HTMLButtonElement>('[data-testid="button-close-formats"]')!;
  const formatHeader = formats.querySelector<HTMLElement>(".drawer-heading")!;
  expect(formatHeader.contains(formatClose)).toBe(true);
  expect(formatDialogCss).toMatch(/\.fmt-drawer \.drawer-heading\s*\{[^}]*position:\s*sticky/);
  expect(formatDialogCss).toMatch(/\.fmt-drawer \.drawer-heading\s*\{[^}]*top:\s*0/);
  expect(formats.querySelector('[data-testid="button-export-json"]')).not.toBeNull();
  await act(async () => formatClose.click());

  openProjectMenu(container);
  const longProjectName = "VeryLongProjectName".repeat(10);
  getStorageOverview.mockResolvedValue({
    browser: { usage: 4096, quota: 8192 },
    projects: [
      { id: "current-project", name: "Geöffnetes Modell", bytes: 1024, detail: "1 Stein" },
      { id: "older-project", name: longProjectName, bytes: 2048, detail: "2 Steine" },
    ],
    packages: [{ id: "parts-package", name: "Teilepaket", bytes: 512, detail: "1 Teil · 1 Datei" }],
    snapshots: [{ id: "snapshot", name: "3001.dat", bytes: 128, detail: "1 Datei" }],
  });
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-open-storage"]')!.click());
  await act(async () => { await Promise.resolve(); });
  const storage = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-storage"]')!;
  const storageClose = storage.querySelector<HTMLButtonElement>('[data-testid="button-close-storage"]')!;
  const storageHeader = storage.querySelector<HTMLElement>(".drawer-heading")!;
  expect(storageHeader.contains(storageClose)).toBe(true);
  expect(storageManagerCss).toMatch(/\.sm-drawer \.drawer-heading\s*\{[^}]*position:\s*sticky/);
  expect(storageManagerCss).toMatch(/\.sm-drawer \.drawer-heading\s*\{[^}]*top:\s*0/);
  expect(storageManagerCss).toMatch(/\.sm-confirm \.confirm-actions\s*\{[^}]*position:\s*sticky/);
  expect(cssRule(storageManagerCss, ".sm-confirm")["box-sizing"]).toBe("border-box");
  expect(cssRule(storageManagerCss, ".sm-confirm .confirm-actions")["flex-wrap"]).toBe("wrap");
  expect(cssRule(storageManagerCss, ".sm-confirm-copy p")["overflow-wrap"]).toBe("anywhere");
  expect(cssRule(storageManagerCss, ".sm-confirm .confirm-actions button")["white-space"]).toBe("normal");
  expect(cssRule(storageManagerCss, ".sm-confirm .confirm-actions button")["overflow-wrap"]).toBe("anywhere");
  await act(async () => storage.querySelector<HTMLButtonElement>('[data-testid="button-delete-project-older-project"]')!.click());
  const confirmation = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-confirm-storage"]')!;
  expect(confirmation.querySelector(".sm-confirm-copy")?.textContent).toContain(longProjectName);
  expect(confirmation.querySelector<HTMLButtonElement>('[data-testid="button-cancel-storage-action"]')?.disabled).toBe(false);
  expect(confirmation.querySelector<HTMLButtonElement>('[data-testid="button-confirm-storage-action"]')?.disabled).toBe(false);
  await act(async () => confirmation.querySelector<HTMLButtonElement>('[data-testid="button-cancel-storage-action"]')!.click());
  await act(async () => storageClose.click());

  openProjectMenu(container);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-open-privacy"]')!.click());
  const privacy = documentRef.body.querySelector<HTMLElement>('[role="dialog"]')!;
  const privacyScrollArea = privacy.querySelector<HTMLElement>(".overflow-y-auto.overscroll-contain")!;
  const privacyClose = [...privacy.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.includes("Close"))!;
  expect(privacy.className).toContain("overflow-hidden");
  expect(privacyScrollArea.className).toContain("max-h-[calc(85vh-3rem)]");
  expect(privacyScrollArea.contains(privacyClose)).toBe(false);
  expect(privacyClose.parentElement).toBe(privacy);
});

it("keeps the gesture guide close button reachable and keyboard-operable at 200% text size", async () => {
  const container = await mount("light", false, "en", { viewport: { width: 320, height: 280 } });
  textScaleStyle = documentRef.createElement("style");
  textScaleStyle.textContent = "html { font-size: 200%; -webkit-text-size-adjust: 200%; text-size-adjust: 200%; }";
  documentRef.head.appendChild(textScaleStyle);

  const helpButton = container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!;
  helpButton.focus();
  await act(async () => helpButton.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  const scrollArea = dialog.querySelector<HTMLElement>(".gesture-guide-scroll-area")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>("button")!;

  expect(scrollArea.contains(closeButton)).toBe(false);
  expect(closeButton.className).toContain("absolute");
  expect(closeButton.textContent).toContain("Close");
  closeButton.focus();
  expect(documentRef.activeElement).toBe(closeButton);

  await act(async () => {
    closeButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  expect(documentRef.body.querySelector('[data-testid="dialog-gesture-help"]')).toBeNull();
});

it.each(["de", "en"] as const)("keeps help labels and action descriptions aligned with controls in %s", async language => {
  const container = await mount("light", true, language);
  const projectMenu = container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!;
  await act(async () => projectMenu.click());
  const menuControls = [
    ["project.newAction", "button-new-project", "Create a new empty project", "Erstellt ein neues leeres Projekt"],
    ["project.import", "button-open-import", "Import a model or parts list", "Importiert ein Modell oder eine Teileliste"],
    ["project.export", "button-open-export", "Export the model or its parts list", "Exportiert das Modell oder dessen Teileliste"],
    ["project.instructions", "button-open-instructions", "View or edit building steps", "Bauanleitungsschritte ansehen oder bearbeiten"],
    ["project.storage", "button-open-storage", "Review or remove locally stored projects", "Lokal gespeicherte Projekte"],
    ["project.privacy", "button-open-privacy", "Manage privacy options", "Datenschutzoptionen verwalten"],
  ] as const;
  const menuLabels = menuControls.map(([title, testId, ...phrases]) => {
    const label = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.textContent!.trim();
    return { title, label, actionPhrase: language === "en" ? phrases[0] : phrases[1] };
  });
  await act(async () => projectMenu.click());

  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;
  const headerSection = HELP_BUTTON_SECTIONS.find(section => section.title === "help.section.header")!;
  const projectSection = HELP_BUTTON_SECTIONS.find(section => section.title === "help.section.projectMenu")!;
  expect(container.querySelector(".topbar-end .language-menu")).not.toBeNull();
  expect(headerSection.buttons.map(item => item.title)).toContain("language");
  expect(projectSection.buttons.map(item => item.title)).not.toContain("language");
  const readHelpEntry = (title: string) => {
    const entries = [...dialog.querySelectorAll<HTMLElement>(".gesture-guide-buttons li, .gesture-guide-modes article")];
    const entry = entries.find(candidate => candidate.querySelector("strong")?.textContent?.trim() === title);
    expect(entry, `Expected a help entry named "${title}"`).toBeDefined();
    return entry!;
  };
  const readButtonHelpEntry = (titleKey: string) => {
    const items = HELP_BUTTON_SECTIONS.flatMap(section => section.buttons);
    const index = items.findIndex(item => item.title === titleKey);
    expect(index, `Expected a help item keyed "${titleKey}"`).toBeGreaterThanOrEqual(0);
    const entries = [...dialog.querySelectorAll<HTMLElement>(".gesture-guide-buttons li")];
    expect(entries).toHaveLength(items.length);
    return entries[index];
  };
  const languageGuideEntry = readButtonHelpEntry("language");
  expect(languageGuideEntry.querySelector("strong")?.textContent?.trim()).toBe(language === "en" ? "Language" : "Sprache");
  expect(languageGuideEntry.querySelector("p")?.textContent?.toLocaleLowerCase())
    .toContain(language === "en" ? "top bar" : "oben");
  const themeGuideEntry = readButtonHelpEntry("help.button.theme");
  expect(themeGuideEntry.querySelector("strong")?.textContent?.toLocaleLowerCase())
    .toContain(language === "en" ? "system" : "system");
  expect(themeGuideEntry.querySelector("p")?.textContent?.toLocaleLowerCase())
    .toContain(language === "en" ? "device" : "systemmodus");

  const modeActions = language === "en"
    ? ["without editing it", "tap or drag on the floor", "Select, move, recolor", "Tap parts to remove them"]
    : ["ohne es zu bearbeiten", "mit Tipp oder Ziehen auf dem Boden", "Teile auswählen, bewegen", "Teile durch Antippen löschen"];
  const modes = [
    ["view", "View", "editor.viewMode"],
    ["build", "Build", "editor.buildMode"],
    ["select", "Select", "editor.selectMode"],
    ["delete", "Delete", "editor.deleteMode"],
  ] as const;
  for (const [index, [mode, englishLabel, titleKey]] of modes.entries()) {
    const control = container.querySelector<HTMLButtonElement>(`[data-testid="button-tool-${mode}"]`)!;
    const label = control.querySelector("span")!.textContent!.trim();
    if (language === "en") expect(label).toBe(englishLabel);
    const helpEntry = readHelpEntry(label);
    expect(helpEntry.querySelector("p")?.textContent?.toLocaleLowerCase())
      .toContain(modeActions[index].toLocaleLowerCase());
    expect(HELP_MODE_OVERVIEW.some(item => item.title === titleKey)).toBe(true);
  }

  const directControls = [
    ["button-gesture-help", "gesture.help", language === "en" ? "Open this guide" : "Öffnet diese Übersicht"],
    ["button-save", "save.action", language === "en" ? "Save the current project locally" : "Speichert das aktuelle Projekt lokal"],
    ["button-undo", "history.undo", language === "en" ? "Undo the most recent model change" : "Macht die letzte Modelländerung rückgängig"],
    ["button-redo", "history.redo", language === "en" ? "Redo a change that was undone" : "Stellt eine rückgängig gemachte Änderung wieder her"],
    ["button-thick-edges", "canvas.thickEdges", language === "en" ? "Cycle through no edges" : "Wechselt zwischen keinen Kanten"],
    ["mobile-button-colors", "editor.colorMode", language === "en" ? "Open the color picker" : "Öffnet die Farbauswahl"],
    ["mobile-button-parts", "editor.partsTool", language === "en" ? "Open the part chooser" : "Öffnet die Teileauswahl"],
  ] as const;
  for (const [testId, titleKey, actionPhrase] of directControls) {
    const control = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
    const label = testId === "button-thick-edges"
      ? control.querySelector(".thick-edges-label")?.textContent?.trim()
      : testId === "mobile-button-colors"
        ? control.querySelector("span:last-child")?.textContent?.trim()
      : control.getAttribute("aria-label") ?? control.querySelector("span")?.textContent?.trim() ?? control.textContent!.trim();
    const guideItem = HELP_BUTTON_SECTIONS.flatMap(section => section.buttons).find(item => item.title === titleKey)!;
    expect(guideItem).toBeDefined();
    const entry = readButtonHelpEntry(titleKey);
    expect(entry.querySelector("strong")?.textContent?.trim()).toBe(label);
    expect(entry.querySelector("p")?.textContent?.toLocaleLowerCase()).toContain(actionPhrase.toLocaleLowerCase());
  }

  const selectedControls = [
    ["fine.title", "button-fine-adjustment", "title", language === "en" ? "Open fine positioning" : "Öffnet die Feinjustierung"],
    ["group.title", "button-group-selection", "title", language === "en" ? "Open multi-selection" : "Öffnet die Mehrfachauswahl"],
    ["tilt.title", "button-tilt-controls", "title", language === "en" ? "Open rotation and tilt controls" : "Öffnet die Dreh- und Neigungssteuerung"],
    ["editor.remove", "button-delete-selected", "text", language === "en" ? "Delete the selected part or parts" : "Löscht das ausgewählte Teil"],
  ] as const;
  for (const [titleKey, testId, labelSource, actionPhrase] of selectedControls) {
    const control = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
    const label = labelSource === "title" ? control.getAttribute("title") : control.textContent?.trim();
    const entry = readButtonHelpEntry(titleKey);
    expect(entry.querySelector("strong")?.textContent?.trim()).toBe(label);
    expect(entry.querySelector("p")?.textContent?.toLocaleLowerCase()).toContain(actionPhrase.toLocaleLowerCase());
  }

  const heightButtons = [...container.querySelectorAll<HTMLButtonElement>(".mobile-selection-actions > button")].slice(0, 2);
  expect(heightButtons.map(button => button.getAttribute("aria-label"))).toEqual(language === "en"
    ? ["Move part up by one plate", "Move part down by one plate"]
    : ["Stein eine Plattenhöhe höher", "Stein eine Plattenhöhe tiefer"]);
  const heightHelp = readButtonHelpEntry("help.button.height");
  expect(heightHelp.querySelector("strong")?.textContent).toBe(language === "en" ? "Raise / lower" : "Höher / tiefer");
  expect(heightHelp.querySelector("p")?.textContent?.toLocaleLowerCase())
    .toContain(language === "en" ? "up or down by one plate step" : "in platten-schritten nach oben oder unten");

  for (const { title, label, actionPhrase } of menuLabels) {
    const guideItem = HELP_BUTTON_SECTIONS.flatMap(section => section.buttons).find(item => item.title === title)!;
    expect(guideItem).toBeDefined();
    const helpLabel = title === "project.privacy"
      ? language === "en" ? "Privacy" : "Datenschutz"
      : label;
    expect(label.toLocaleLowerCase()).toContain(helpLabel.toLocaleLowerCase());
    const entry = readButtonHelpEntry(title);
    expect(entry.querySelector("strong")?.textContent?.trim()).toBe(helpLabel);
    expect(entry.querySelector("p")?.textContent?.toLocaleLowerCase()).toContain(actionPhrase.toLocaleLowerCase());
  }

  const textOnlyItems = HELP_BUTTON_SECTIONS.flatMap(section => section.buttons).filter(item => !item.icon);
  expect(textOnlyItems).toHaveLength(1);
  for (const item of textOnlyItems) {
    const entry = readButtonHelpEntry(item.title);
    expect(entry.querySelector("strong")?.textContent).toBe(language === "en" ? "On this device" : "Auf diesem Gerät");
    expect(entry.querySelector(".gesture-guide-button-visual, svg")).toBeNull();
    expect(item.icon).toBeUndefined();
  }
});

it("shows every mode's gesture help in German", async () => {
  const container = await mount("dark", false, "de");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-gesture-help"]')!.click());
  const dialog = documentRef.body.querySelector<HTMLElement>('[data-testid="dialog-gesture-help"]')!;

  expect(dialog.textContent).toContain("Hilfe: Modi, Schaltflächen und Gesten");
  expect(dialog.textContent).toContain("Ansichtsmodus");
  expect(dialog.textContent).toContain("Auswahlmodus");
  expect(dialog.textContent).toContain("Baumodus");
  expect(dialog.textContent).toContain("Löschmodus");
  expect(dialog.textContent).toContain("Doppeltipp auf freie Fläche");
  expect(dialog.textContent).toContain("Doppeltipp auf einen Dreh- oder Neigungsregler");
  expect(dialog.textContent).toContain("Verbundene obere Teile mitbewegen");
  expect(dialog.textContent).toContain("Datei importieren");
  expect(dialog.textContent).toContain("Android: Der Export kann bis zu zwei Stunden im Hintergrund oder bei ausgeschaltetem Bildschirm weiterlaufen.");
  expect(dialog.querySelectorAll(".gesture-guide-button-visual").length).toBeGreaterThan(20);
  expect(editorCss).toContain(".dark .gesture-guide-dialog");
});

it("cycles the edge control through off, thin, and thick, then persists off", async () => {
  localStorage.removeItem("brickbuilder-thick-edges");
  const container = await mount("light");
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="button-thick-edges"]')!;
  expect(toggle).not.toBeNull();
  expect(toggle.hidden).toBe(false);
  expect(toggle.textContent).toContain("Kanten");
  expect(toggle.dataset.edgeMode).toBe("off");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(toggle.getAttribute("aria-label")).toBe("Kanten aus");
  expect(canvasProps.current.edgeMode).toBe("off");

  act(() => toggle.click());
  expect(toggle.dataset.edgeMode).toBe("thin");
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(toggle.textContent).toContain("Kanten");
  expect(toggle.getAttribute("aria-label")).toBe("Dünne Kanten");
  expect(canvasProps.current.edgeMode).toBe("thin");
  expect(localStorage.getItem("brickbuilder-thick-edges")).toBe("thin");

  act(() => toggle.click());
  expect(toggle.dataset.edgeMode).toBe("thick");
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(toggle.getAttribute("aria-label")).toBe("Dicke Kanten");
  expect(canvasProps.current.edgeMode).toBe("thick");
  expect(localStorage.getItem("brickbuilder-thick-edges")).toBe("thick");

  act(() => toggle.click());
  expect(toggle.dataset.edgeMode).toBe("off");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(canvasProps.current.edgeMode).toBe("off");
  expect(localStorage.getItem("brickbuilder-thick-edges")).toBe("off");

  act(() => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  const reopened = await mount("dark");
  expect(reopened.querySelector<HTMLButtonElement>('[data-testid="button-thick-edges"]')?.hidden).toBe(false);
  expect(canvasProps.current.edgeMode).toBe("off");
});

it("opens the existing rotation controls when the canvas reports a part double tap", async () => {
  const host = await mount("light", true);
  const openControls = canvasProps.current.onOpenRotationControls as (id: string) => void;
  expect(openControls).toBeTypeOf("function");

  act(() => openControls("selected-brick"));

  expect(editor.setToolMode).toHaveBeenCalledWith("select");
  expect(editor.select).toHaveBeenCalledWith("selected-brick");
  expect(host.querySelector<HTMLElement>('[data-testid="tilt-controls-menu"]')?.dataset.open).toBe("true");
});

it("opens the rotation panel with the selected imported part's current values", async () => {
  const host = await mount("light", true);
  editor.selectedInstance = {
    id: "selected-import",
    reference: "3001.dat",
    colorCode: "4",
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    part: { ldrawId: "3001", status: "resolved" },
    rotationY: 90,
    tiltX: 12,
    tiltZ: -24,
  };
  await act(async () => root!.render(<I18nProvider><App /></I18nProvider>));
  const menu = host.querySelector<HTMLElement>('[data-testid="tilt-controls-menu"]')!;
  await act(async () => menu.querySelector<HTMLButtonElement>('[data-testid="button-tilt-controls"]')!.click());

  expect(documentRef.body.querySelector<HTMLInputElement>('[data-testid="slider-rotation-y"]')?.value).toBe("90");
  expect(documentRef.body.querySelector<HTMLInputElement>('[data-testid="slider-tilt-x"]')?.value).toBe("12");
  expect(documentRef.body.querySelector<HTMLInputElement>('[data-testid="slider-tilt-z"]')?.value).toBe("-24");
});

it("starts in English and switches the visible app labels to German", async () => {
  const container = await mount("light", false, "en");
  expect(container.textContent).toContain("View");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="language-option-de"]')!.click());
  expect(documentRef.documentElement.lang).toBe("de");
  expect(container.textContent).toContain("Ansicht");
  expect(container.textContent).toContain("Bauen");
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
});

it.each(["en", "de"] as const)("returns focus to the language trigger after selecting %s", async targetLanguage => {
  const initialLanguage = targetLanguage === "en" ? "de" : "en";
  const container = await mount("light", false, initialLanguage);
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;
  await act(async () => trigger.click());
  const option = container.querySelector<HTMLButtonElement>(`[data-testid="language-option-${targetLanguage}"]`)!;
  await act(async () => option.click());

  expect(container.querySelector('[role="menu"]')).toBeNull();
  expect(documentRef.documentElement.lang).toBe(targetLanguage);
  expect(document.activeElement).toBe(trigger);
});

it.each(["Escape", "outside click"] as const)("closes the language dropdown with %s", async dismissal => {
  const container = await mount("light");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!.click());
  expect(container.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () => {
    if (dismissal === "Escape") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else {
      documentRef.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    }
  });
  expect(container.querySelector('[role="menu"]')).toBeNull();
});

it.each(["de", "en"] as const)("returns focus to the language trigger after Escape in %s", async language => {
  const container = await mount("light", false, language);
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;
  expect(trigger.getAttribute("aria-label")).toBe(language === "de" ? "Sprache" : "Language");
  await act(async () => trigger.click());
  const option = container.querySelector<HTMLButtonElement>('[data-testid="language-option-en"]')!;
  option.focus();
  expect(document.activeElement).toBe(option);

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  expect(container.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("hides the canvas status controls for every open mobile selection menu", async () => {
  const container = await mount("light", true);
  const canvas = container.querySelector<HTMLElement>('[data-testid="mock-canvas"]')!;
  expect(canvas.dataset.constructionControls).toBe("true");

  for (const selector of [
    '[data-testid="group-selection-menu"]',
    '.mobile-selection-actions [data-testid="fine-position-menu"]',
    '.mobile-selection-actions [data-testid="tilt-controls-menu"]',
  ]) {
    const menu = container.querySelector<HTMLElement>(selector)!;
    const toggle = menu.querySelector<HTMLElement>(
      ".rotation-selection-toggle, .fine-position-toggle, .tilt-controls-toggle",
    )!;
    await act(async () => toggle!.click());
    expect(menu.dataset.open).toBe("true");
    expect(canvas.dataset.constructionControls).toBe("false");
    expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(false);
    await act(async () => toggle!.click());
    expect(canvas.dataset.constructionControls).toBe("true");
    expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(true);
  }
});

it("disables canvas empty-space zoom when the project menu opens between taps", async () => {
  const container = await mount("light");
  const canvas = container.querySelector<HTMLElement>('[data-testid="mock-canvas"]')!;
  const tap = () => {
    const event = new Event("pointerdown", { bubbles: true });
    canvas.dispatchEvent(event);
  };

  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(true);
  act(tap);
  openProjectMenu(container);
  expect(container.querySelector(".project-popover")).not.toBeNull();
  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(false);
  act(tap);
  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(false);
});

it("disables canvas actions while the language menu is open", async () => {
  const container = await mount("light");
  const languageButton = container.querySelector<HTMLButtonElement>('[data-testid="button-language-menu"]')!;

  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(true);
  await act(async () => languageButton.click());
  expect(container.querySelector("#language-dropdown")).not.toBeNull();
  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(false);

  await act(async () => languageButton.click());
  expect(canvasProps.current.emptyDoubleTapZoomEnabled).toBe(true);
});

it("marks open mobile control menus and closes each one on an outside tap", async () => {
  const container = await mount("light", true);
  const menus = [
    { selector: '[data-testid="group-selection-menu"]', toggle: "button-group-selection" },
    { selector: '.mobile-selection-actions [data-testid="fine-position-menu"]', toggle: "button-fine-adjustment" },
    { selector: '.mobile-selection-actions [data-testid="tilt-controls-menu"]', toggle: "button-tilt-controls" },
  ];
  const outside = container.querySelector<HTMLElement>('[data-testid="mock-canvas"]')!;

  for (const item of menus) {
    const menu = container.querySelector<HTMLElement>(item.selector)!;
    const toggle = menu.querySelector<HTMLButtonElement>(`[data-testid="${item.toggle}"]`)!;
    await act(async () => toggle.click());
    expect(menu.dataset.open).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.classList.contains("is-open")).toBe(true);

    await act(async () => outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu.dataset.open).toBe("false");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.classList.contains("is-open")).toBe(false);
  }
});

it("keeps multi-selection checkboxes in sync with viewport selection and applies color to all checked parts", async () => {
  const container = await mount("light", true);
  const menu = container.querySelector<HTMLElement>('[data-testid="group-selection-menu"]')!;
  await act(async () => menu.querySelector<HTMLButtonElement>('[data-testid="button-group-selection"]')!.click());

  const primary = container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-selected-brick"] input')!;
  const secondary = container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-second-brick"] input')!;
  expect(primary.checked).toBe(true);
  expect(secondary.checked).toBe(false);
  expect(container.textContent).toContain("Mehrfachauswahl");

  await act(async () => secondary.click());
  expect(secondary.checked).toBe(true);
  expect(canvasProps.current.selectedIds).toEqual(["selected-brick", "second-brick"]);
  expect(container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-selected-brick"] input')!.checked).toBe(true);

  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-colors"]')!.click());
  const colorButton = documentRef.body.querySelector<HTMLButtonElement>('[data-testid="drawer-colors"] [data-testid="mobile-color-option"]')!;
  await act(async () => colorButton.click());
  expect(editor.setSelectedColor).toHaveBeenCalledWith("#112233", "1", ["selected-brick", "second-brick"]);
});

it("syncs direct viewport multi-selection into the opened multi-selection menu", async () => {
  const container = await mount("light", true);
  expect(canvasProps.current.selectedIds).toEqual(["selected-brick"]);

  await act(async () => canvasProps.current.onToggleSelection("second-brick"));
  expect(canvasProps.current.selectedIds).toEqual(["selected-brick", "second-brick"]);

  const menu = container.querySelector<HTMLElement>('[data-testid="group-selection-menu"]')!;
  await act(async () => menu.querySelector<HTMLButtonElement>('[data-testid="button-group-selection"]')!.click());
  expect(container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-selected-brick"] input')!.checked).toBe(true);
  expect(container.querySelector<HTMLInputElement>('[data-testid="group-selection-item-second-brick"] input')!.checked).toBe(true);
});

it("preserves part selection on the tap that closes a menu and allows selection on the next tap", async () => {
  const container = await mount("light", true);
  const menu = container.querySelector<HTMLElement>('[data-testid="group-selection-menu"]')!;
  const toggle = menu.querySelector<HTMLButtonElement>('[data-testid="button-group-selection"]')!;
  const canvas = container.querySelector<HTMLElement>('[data-testid="mock-canvas"]')!;
  await act(async () => toggle.click());
  editor.select.mockClear();

  await act(async () => canvas.dispatchEvent(new Event("pointerdown", { bubbles: true })));

  expect(menu.dataset.open).toBe("false");
  expect(editor.select).not.toHaveBeenCalled();

  await act(async () => canvas.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(editor.select).toHaveBeenCalledOnce();
  expect(editor.select).toHaveBeenCalledWith(null);
});

it("keeps all three mobile panels open on a grip tap and moves them only after dragging", async () => {
  const container = await mount("light", true);
  const menus = [
    { selector: '[data-testid="group-selection-menu"]', toggle: "button-group-selection", grip: "button-move-group-panel-mobile", panel: ".rotation-selection-panel" },
    { selector: '.mobile-selection-actions [data-testid="fine-position-menu"]', toggle: "button-fine-adjustment", grip: "button-move-fine-panel", panel: ".fine-position-panel" },
    { selector: '.mobile-selection-actions [data-testid="tilt-controls-menu"]', toggle: "button-tilt-controls", grip: "button-move-tilt-panel", panel: ".tilt-panel" },
  ];
  for (const item of menus) {
    const menu = container.querySelector<HTMLElement>(item.selector)!;
    const toggle = menu.querySelector<HTMLButtonElement>(`[data-testid="${item.toggle}"]`)!;
    await act(async () => toggle.click());
    const panel = documentRef.body.querySelector<HTMLElement>(`${item.panel}.draggable-panel-portal`)!;
    const grip = panel.querySelector<HTMLElement>(`[data-testid="${item.grip}"]`)!;
    expect(panel).not.toBeNull();
    expect(panel.parentElement).toBe(documentRef.body);
    const pointer = (target: EventTarget, type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { pointerId: { value: 3 }, pointerType: { value: "touch" }, clientX: { value: x }, clientY: { value: y } });
      target.dispatchEvent(event);
    };
    await act(async () => {
      pointer(grip, "pointerdown", 80, 80);
      pointer(window, "pointerup", 80, 80);
      grip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(menu.dataset.open).toBe("true");
    expect(panel.classList.contains("is-positioned")).toBe(false);
    await act(async () => {
      pointer(grip, "pointerdown", 80, 80);
      pointer(window, "pointermove", 112, 118);
      pointer(window, "pointerup", 112, 118);
    });
    expect(menu.dataset.open).toBe("true");
    expect(panel.classList.contains("is-positioned")).toBe(true);
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThan(8);
  }
});

function openProjectMenu(container: HTMLElement) {
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-project-menu"]')!.click());
}

it("places the Premium purchase directly below privacy only for non-premium Android users", async () => {
  const container = await mount("light");
  openProjectMenu(container);
  const privacy = container.querySelector('[data-testid="button-open-privacy"]')!;
  const purchase = container.querySelector('[data-testid="button-open-premium"]')!;
  expect(privacy.nextElementSibling).toBe(purchase);
  expect(privacy.querySelector("svg")?.classList.contains("lucide-scale")).toBe(true);
  expect(purchase.querySelector("svg")?.classList.contains("lucide-star")).toBe(true);
  expect(purchase.textContent).toContain("Premium kaufen");
  premium.active = true;
  act(() => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(container.querySelector('[data-testid="button-open-premium"]')).toBeNull();
  premium.active = false; premium.status = "loading";
  act(() => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(container.querySelector('[data-testid="button-open-premium"]')).toBeNull();
  premium.status = "ready";
  vi.stubEnv("VITE_NATIVE_ANDROID", "false");
  act(() => root!.render(<I18nProvider><App /></I18nProvider>));
  expect(container.querySelector('[data-testid="button-open-premium"]')).toBeNull();
});

it.each(["light", "dark"] as const)(
  "opens the mobile format, storage, privacy and inventory surfaces in %s mode",
  async theme => {
    const container = await mount(theme);

    openProjectMenu(container);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-export"]')!.click());
    let dialog = container.querySelector<HTMLElement>('[data-testid="dialog-formats"]')!;
    expect(dialog.textContent).toContain("Datei exportieren");
    expect(dialog.querySelector('[data-testid="button-export-json"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="button-export-bricklink"]')).not.toBeNull();
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="tab-format-import"]')!.click());
    expect(dialog.querySelector<HTMLInputElement>('[data-testid="input-import-file"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="warning-offline-import-incomplete"]')?.textContent)
      .toContain("Import kann unvollständig sein");
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="button-close-formats"]')!.click());

    openProjectMenu(container);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-storage"]')!.click());
    await act(async () => { await Promise.resolve(); });
    dialog = document.body.querySelector<HTMLElement>('[data-testid="dialog-storage"]')!;
    expect(dialog.textContent).toContain("Browser-Speicher dieser Website");
    expect(dialog.textContent).toContain("Früheres Modell");
    expect(dialog.querySelector('[data-testid="button-delete-project-older-project"]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="button-remove-package-parts-package"]')).not.toBeNull();
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="button-delete-project-older-project"]')!.click());
    expect(document.body.querySelector('[data-testid="dialog-confirm-storage"]')?.textContent).toContain("nicht rückgängig gemacht");
    expect(document.body.querySelector('[data-testid="button-cancel-storage-action"]')).not.toBeNull();
    act(() => document.body.querySelector<HTMLButtonElement>('[data-testid="button-cancel-storage-action"]')!.click());
    act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="button-close-storage"]')!.click());

    openProjectMenu(container);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-privacy"]')!.click());
    const privacy = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(privacy.textContent).toContain("Datenschutzeinstellungen");
    expect(privacy.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(privacy.querySelector("iframe")?.title).toBe("Datenschutzerklärung");
    act(() => privacy.querySelector<HTMLButtonElement>("button")!.click());

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="mobile-button-parts"]')!.click());
    const parts = container.querySelector<HTMLElement>('[data-testid="drawer-parts"]')!;
    await act(async () => {
      parts.querySelector<HTMLButtonElement>('[data-testid="tab-inventory"]')!.click();
      await Promise.resolve();
    });
    const inventory = parts.querySelector<HTMLElement>('[data-testid="panel-inventory"]')!;
    expect(inventory.textContent).toContain("mobile.csv");
    expect(inventory.textContent).toContain("CSV-Vorlage");
    expect(inventory.querySelector('[data-testid="input-inventory-file"]')).not.toBeNull();
    expect(inventory.querySelector('[data-testid="input-inventory-search"]')).not.toBeNull();
    expect(inventory.querySelector('[data-testid^="button-inventory-use-"]')).not.toBeNull();
    expect(parts.querySelector('[data-testid="tab-inventory"]')?.getAttribute("aria-selected")).toBe("true");
  },
);

it("hides the Android import completeness warning when online geometry is enabled", async () => {
  const container = await mount("light");
  expect(setRemoteGeometryEnabled(true)).toBe(true);

  openProjectMenu(container);
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-export"]')!.click());
  const dialog = container.querySelector<HTMLElement>('[data-testid="dialog-formats"]')!;
  act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="tab-format-import"]')!.click());

  expect(dialog.querySelector('[data-testid="warning-offline-import-incomplete"]')).toBeNull();
});

it("shows the Android import warning in English too", async () => {
  const container = await mount("light", false, "en");

  openProjectMenu(container);
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-open-export"]')!.click());
  const dialog = container.querySelector<HTMLElement>('[data-testid="dialog-formats"]')!;
  act(() => dialog.querySelector<HTMLButtonElement>('[data-testid="tab-format-import"]')!.click());

  expect(dialog.querySelector('[data-testid="warning-offline-import-incomplete"]')?.textContent)
    .toContain("The import may be incomplete");
});

it("keeps dark inventory errors and storage details on readable theme tokens", () => {
  expect(darkThemeCss).toMatch(/\.dark \.inv-panel :is\(\.inv-error, \.inv-issue, \.inv-problems\)[\s\S]*?color:\s*hsl\(8 80% 82%\)/);
  expect(darkThemeCss).toMatch(/\.dark \.inv-panel :is\(\.inv-note, \.inv-template code\)[\s\S]*?color:\s*hsl\(var\(--foreground\)\)/);
  expect(darkThemeCss).toMatch(/\.dark \.sm-drawer :is\(\.sm-gauge p, \.sm-note, \.sm-row-copy small/);
  expect(darkThemeCss).toMatch(/\.dark \.sm-drawer \.sm-notice[\s\S]*?color:\s*hsl\(150 32% 82%\)/);
  expect(darkThemeCss).toMatch(/\.dark \.fmt-drawer :is\(input, select, textarea\)[\s\S]*?color:\s*hsl\(var\(--foreground\)\)/);
});

it("outlines color circles in dark mode", () => {
  expect(darkThemeCss).toMatch(/\.dark \.swatch\s*\{\s*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*\.82\)/);
  expect(darkThemeCss).toMatch(/\.dark \.mobile-color-option > span:first-child,\s*\.dark \.dock-color-dot\s*\{[\s\S]*?border:\s*1px solid rgba\(255,\s*255,\s*255,\s*\.82\)/);
});
