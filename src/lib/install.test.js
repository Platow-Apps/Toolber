import test from "ava";
import { installMode, isIos, isStandalone, pushNeedsInstall } from "./install.js";

const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/605.1" };
const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1", maxTouchPoints: 5 };
const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1", maxTouchPoints: 0 };
const android = { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120", maxTouchPoints: 5 };

const browserTab = { matchMedia: () => ({ matches: false }), navigator: {} };
const installed = { matchMedia: () => ({ matches: true }), navigator: {} };

test("recognises an iPhone", (t) => {
  t.true(isIos(iphone));
  t.false(isIos(android));
});

test("recognises an iPad that claims to be a Mac", (t) => {
  // iPadOS 13 onwards sends a Macintosh user agent. Touch points are what
  // separate it from a real Mac, which reports none.
  t.true(isIos(ipad));
  t.false(isIos(mac), "a real Mac must not be mistaken for one");
});

test("knows an installed app from a browser tab", (t) => {
  t.true(isStandalone(installed));
  t.false(isStandalone(browserTab));
});

test("trusts Apple's older standalone flag too", (t) => {
  // navigator.standalone predates display-mode and is still the reliable
  // answer on iOS.
  t.true(isStandalone({ navigator: { standalone: true }, matchMedia: () => ({ matches: false }) }));
});

test("offers iPhone owners the manual route, since iOS gives no API", (t) => {
  t.is(installMode({ win: browserTab, nav: iphone }), "ios-manual");
});

test("offers nothing where there is nothing useful to offer", (t) => {
  // An Android browser that never fired beforeinstallprompt — already
  // installed, unsupported, or declined before. A nudge with no button is
  // just noise.
  t.is(installMode({ win: browserTab, nav: android }), "none");
});

test("says nothing at all once installed", (t) => {
  t.is(installMode({ win: installed, nav: iphone }), "installed");
});

test("push needs installing only on an uninstalled iOS device", (t) => {
  // The distinction Settings needs. On iOS this is a step someone can take;
  // anywhere else a browser without push is simply a browser without push,
  // and telling them to install would be a lie.
  t.true(pushNeedsInstall({ win: browserTab, nav: iphone }));
  t.false(pushNeedsInstall({ win: installed, nav: iphone }), "already installed");
  t.false(pushNeedsInstall({ win: browserTab, nav: android }), "not an Apple restriction");
});
