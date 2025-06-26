import ts from "typescript";
import { f } from "../factory";

export function isUndefinedArgument(argument: ts.Node | undefined): boolean {
	return argument ? f.is.identifier(argument) && argument.text === "undefined" : true;
}
