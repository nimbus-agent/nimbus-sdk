import { expect, test } from "bun:test";
import pkg from "../package.json";

test("package identity is standalone nimbus-sdk", () => {
  expect(pkg.name).toBe("@nimbus-dev/sdk");
  expect(pkg.version).toBe("1.3.0");
  expect(pkg.license).toBe("MIT");
  expect(pkg.repository.url).toBe("git+https://github.com/nimbus-agent/nimbus-sdk.git");
  expect((pkg.repository as Record<string, unknown>).directory).toBeUndefined();
  expect((pkg as Record<string, unknown>).dependencies).toBeUndefined();
});
