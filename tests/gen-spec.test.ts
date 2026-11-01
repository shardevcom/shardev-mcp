import { describe, expect, test } from "vitest";
import { resolveProjectSpec } from "../src/gen/spec.js";
import { SPEC } from "./helpers/gen-fixtures.js";

const withApp = (patch: Record<string, unknown>, i = 0) => ({
  ...SPEC,
  apps: SPEC.apps.map((a, j) => (j === i ? { ...a, ...patch } : a)),
});
const bad = (spec: unknown, re: RegExp) => expect(() => resolveProjectSpec(spec)).toThrow(re);

describe("ProjectSpec", () => {
  test("deriva todos los nombres de key y permite sobrescribirlos", () => {
    const s = resolveProjectSpec(SPEC);
    expect(s.apps[0]).toMatchObject({ key: "web", provider: "webs", table: "webs", model: "Web", api_guard: "web", session_guard: "web_session", build_dir: "build-web", features: ["mfa"] });
    const o = resolveProjectSpec(withApp({ table: "users", model: "User", api_guard: "api_web", build_dir: "dist-web" }));
    expect(o.apps[0]).toMatchObject({ table: "users", model: "User", api_guard: "api_web", build_dir: "dist-web", provider: "webs" });
  });

  test.each([
    ["../x"], ["a/b"], ["A"], ["web app"], ["web\\x"], ["1web"], ["we-b"], [".."], ["web\0"], [""],
  ])("key inválida %j", (key) => bad(withApp({ key }), /invalid_spec|Spec inválido/));

  test("sin separadores de ruta ni traversal en ningún nombre", () => {
    for (const patch of [
      { build_dir: "../escape" }, { build_dir: "a/b" }, { build_dir: "/abs" },
      { api_guard: "a/b" }, { session_guard: "../x" }, { table: "a.b" }, { provider: "x/y" }, { model: "A/B" },
    ]) bad(withApp(patch), /Spec inválido/);
    bad({ ...SPEC, name: "../acme" }, /Spec inválido/);
    bad({ ...SPEC, name: "a/b" }, /Spec inválido/);
    bad({ ...SPEC, domain: "acme.com/../x" }, /Spec inválido/);
    bad({ ...SPEC, mobile: { app: "web", app_id: "com/acme/app", app_name: "Acme" } }, /Spec inválido/);
    bad({ ...SPEC, mobile: { app: "web", app_id: "com.acme.app", app_name: "../Acme" } }, /Spec inválido/);
  });

  test("rechaza duplicados: key, guard (incluido api vs sesión entre apps), tabla, puerto, build_dir", () => {
    bad({ ...SPEC, apps: [SPEC.apps[0], { ...SPEC.apps[1], key: "web", port: 6000 }] }, /key duplicado/);
    bad(withApp({ api_guard: "adm" }, 0), /guard duplicado "adm"/);
    bad(withApp({ session_guard: "adm" }, 0), /guard duplicado "adm"/);
    bad(withApp({ api_guard: "same", session_guard: "same" }, 0), /guard duplicado "same"/);
    bad(withApp({ table: "adms" }, 0), /tabla duplicado "adms"/);
    bad(withApp({ port: 5174 }, 0), /puerto duplicado "5174"/);
    bad(withApp({ build_dir: "build-adm" }, 0), /build_dir duplicado/);
  });

  test("puerto fuera de rango, campos desconocidos y mobile.app no declarada", () => {
    bad(withApp({ port: 80 }), /Spec inválido/);
    bad(withApp({ port: 70000 }), /Spec inválido/);
    bad(withApp({ nope: 1 }), /Spec inválido/);
    bad({ ...SPEC, mobile: { app: "ghost", app_id: "com.acme.app", app_name: "Acme" } }, /no es una app declarada/);
    expect(resolveProjectSpec({ ...SPEC, mobile: { app: "web", app_id: "com.acme.app", app_name: "Acme App" } }).mobile?.platforms).toEqual(["android"]);
  });

  test("social exige proveedores y viceversa", () => {
    bad(withApp({ features: ["social"] }), /requiere social_providers/);
    bad(withApp({ social_providers: ["google"] }), /sin la feature social/);
    expect(resolveProjectSpec(withApp({ features: ["social"], social_providers: ["google"] })).apps[0]?.social_providers).toEqual(["google"]);
  });

  test("features otp y social: proveedores solo google, microsoft, apple; auto_register por defecto false", () => {
    const ok = resolveProjectSpec(withApp({ features: ["otp", "social"], social_providers: ["google", "microsoft", "apple", "google"] }));
    expect(ok.apps[0]).toMatchObject({ features: ["otp", "social"], social_providers: ["google", "microsoft", "apple"], auto_register: false });
    for (const p of ["facebook", "github", "Google", ""]) bad(withApp({ features: ["social"], social_providers: [p] }), /Spec inválido/);
    bad(withApp({ features: ["inventada"] }), /Spec inválido/);
  });

  test("auto_register solo con otp o social", () => {
    bad(withApp({ auto_register: true }), /auto_register solo tiene sentido/);
    expect(resolveProjectSpec(withApp({ features: ["otp"], auto_register: true })).apps[0]?.auto_register).toBe(true);
    expect(resolveProjectSpec(withApp({ features: ["social"], social_providers: ["apple"], auto_register: true })).apps[0]?.auto_register).toBe(true);
    bad(withApp({ auto_register: "yes" }), /Spec inválido/);
  });

  test("mfa no se combina con otp ni social (v1: otros caminos emitirían el token sin segundo factor)", () => {
    expect(resolveProjectSpec(withApp({ features: ["mfa"] })).apps[0]?.features).toEqual(["mfa"]);
    bad(withApp({ features: ["mfa", "otp"] }), /app web: la feature mfa no se puede combinar con otp ni social/);
    bad(withApp({ features: ["mfa", "social"], social_providers: ["google"] }), /la feature mfa no se puede combinar con otp ni social/);
    // en otra app del mismo proyecto sí puede haber otp: la restricción es por app
    const mixed = resolveProjectSpec({ ...SPEC, apps: [{ ...SPEC.apps[0], features: ["mfa"] }, { ...SPEC.apps[1], features: ["otp"] }] });
    expect(mixed.apps.map((a) => a.features)).toEqual([["mfa"], ["otp"]]);
  });

  test("invitations no se combina con auto_register; sí con otp o social sin auto_register", () => {
    expect(resolveProjectSpec(withApp({ features: ["invitations"] })).apps[0]?.features).toEqual(["invitations"]);
    expect(resolveProjectSpec(withApp({ features: ["invitations", "otp"] })).apps[0]?.auto_register).toBe(false);
    bad(withApp({ features: ["invitations", "otp"], auto_register: true }), /invitations no se puede combinar con auto_register/);
    bad(withApp({ features: ["invitations", "social"], social_providers: ["google"], auto_register: true }), /invitations no se puede combinar con auto_register/);
  });
});
