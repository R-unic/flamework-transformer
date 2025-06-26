# @runicly/rbxts-transformer-flamework

A fork of the Flamework transformer that implements an AST macro system. This transformer will work as a drop-in replacement to the original Flamework transformer.

Only some generation of AST nodes is currently supported, ideally all expressions will be supported in the future.

## Basic example

You can turn a function declaration into an AST macro using the `ast-macro` metadata. Do note that these functions cannot have implementations, they must be only signatures. This is because the entire function call is replaced with the macro's target AST node. You can provide this target node using a type structured the same as TypeScript AST nodes (with some utilities). You can then use `{@link T ast-macro-target}` to link the target to your function declaration. Alternatively, you can use `Modding.Many<T>` on an optional parameter, just like a standard user macro.

```ts
import type ts from "typescript";

interface GetNumberMacro {
	readonly kind: ts.SyntaxKind.NumericLiteral; // every AST node definition must have a `kind` field that is a SyntaxKind
	readonly value: 69; // the value of the numeric literal
}

/** @metadata ast-macro {@link GetNumberMacro ast-macro-target} */
declare function getNumber();

const n = getNumber()
```

### Result

```lua
local n = 69
```

## Extending interfaces

```ts
interface NumberExtensions_Sqrt {
  readonly kind: ts.SyntaxKind.BinaryExpression; // a binary operation, such as 1 + 1
	// `left` is an expression, but we pass a number type instead of an AST node type.
	// this is because you can map arguments passed into the macro function into your result AST.
	// the number represents which argument is inserted, in this case the first argument.
	// because the definition of `sqrt()` has a `this` parameter, `this` is considered the first argument, in this case `n`.
  readonly left: 0;
  readonly operatorToken: ts.SyntaxKind.AsteriskAsteriskToken; // the operation to perform, in this case exponentation (**)
  readonly right: {
    readonly kind: ts.SyntaxKind.NumericLiteral;
    readonly value: 0.5;
  };
}

interface Number {
	/** @metadata ast-macro {@link NumberExtensions_Sqrt ast-macro-target} */
	sqrt(this: number): number;
}

const n = 69;
print(n.sqrt());
```

### Result

```lua
local n = 69
print(n ^ 0.5)
```

## Mapping arguments into arrays

```ts
interface AllArguments {
  readonly kind: ts.SyntaxKind.ArrayLiteralExpression;
	readonly elements: true; // `true` to signify inserting ALL passed arguments
}
 
interface FirstThreeArguments {
  readonly kind: ts.SyntaxKind.ArrayLiteralExpression;
	readonly elements: [0, 1, 2]; // only insert arguments at positions 0, 1, and 2 (the first three)
}

/** @metadata ast-macro {@link AllArguments ast-macro-target} */
declare function all<T>(...args: T[]): T[];
/** @metadata ast-macro {@link FirstThreeArguments ast-macro-target} */
declare function firstThree<T>(...args: T[]): T[];

const a1 = all(1, 2, 3, 4, 5, 6);
const a2 = firstThree(1, 2, 3, 4, 5, 6);
```

### Result

```lua
local a1 = {1, 2, 3, 4, 5, 6}
local a2 = {1, 2, 3}
```
