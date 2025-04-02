/* eslint-disable @typescript-eslint/no-var-requires */
import { existsSync } from "fs";
import { Module } from "module";
import path from "path";
import { isPathDescendantOf } from "./util/functions/isPathDescendantOf";
import { Logger } from "./classes/logger";
import { tryResolve } from "./util/functions/tryResolve";

const cwd = process.cwd();
const originalRequire = Module.prototype.require;

function shouldTryHooking() {
	if (process.argv.includes("--no-flamework-hook")) {
		return false;
	}

	if (process.argv.includes("--force-flamework-hook")) {
		return true;
	}

	// Ensure we're running in the context of a project and not a multiplace repository or something,
	// as we don't have access to the project directory until roblox-ts invokes the transformer.
	if (
		!existsSync(path.join(cwd, "tsconfig.json")) ||
		!existsSync(path.join(cwd, "package.json")) ||
		!existsSync(path.join(cwd, "node_modules"))
	) {
		return false;
	}

	return true;
}

function hook() {
	const robloxTsPath = tryResolve("roblox-ts", cwd);
	if (!robloxTsPath) {
		return;
	}

	const robloxTsTypeScriptPath = tryResolve("typescript", robloxTsPath);
	if (!robloxTsTypeScriptPath) {
		return;
	}

	const flameworkTypeScript = require("typescript");
	const robloxTsTypeScript = require(robloxTsTypeScriptPath);

	// Flamework and roblox-ts are referencing the same TypeScript module.
	if (flameworkTypeScript === robloxTsTypeScript) {
		return;
	}

	if (flameworkTypeScript.versionMajorMinor !== robloxTsTypeScript.versionMajorMinor) {
		if (Logger.verbose) {
			Logger.write("\n");
		}

		Logger.warn(
			"TypeScript version differs",
			`Flamework: v${flameworkTypeScript.version}, roblox-ts: v${robloxTsTypeScript.version}`,
			`Flamework will switch to v${robloxTsTypeScript.version}, ` +
				`but you can get rid of this warning by running: npm i -D typescript@${robloxTsTypeScript.version}`,
		);
	}

	Module.prototype.require = function flameworkHook(this: NodeJS.Module, id) {
		// Overwrite any Flamework TypeScript imports to roblox-ts' version.
		// To be on the safe side, this won't hook it in packages.
		if (id === "typescript" && isPathDescendantOf(this.filename, __dirname)) {
			return robloxTsTypeScript;
		}

		return originalRequire.call(this, id);
	} as NodeJS.Require;
}

if (shouldTryHooking()) {
	hook();
}

const transformer = require("./transformer");

// After loading Flamework, we can unhook require.
Module.prototype.require = originalRequire;

export = transformer;
