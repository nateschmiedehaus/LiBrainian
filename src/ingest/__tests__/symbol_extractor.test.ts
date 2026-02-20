/**
 * @fileoverview Tests for Symbol Extractor
 *
 * Tests extraction of all TypeScript symbol types including:
 * - Classes, interfaces, types, enums, constants
 * - Class methods, properties, getters, setters
 * - Interface members (property signatures, method signatures)
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractSymbolsFromSource,
  extractSymbolsFromFile,
  extractSymbolsFromFiles,
  extractSymbolsFromDirectory,
} from '../symbol_extractor.js';

/**
 * Helper to extract symbols from a TypeScript code string.
 */
function extractSymbols(code: string, filePath = 'test.ts') {
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return extractSymbolsFromSource(sourceFile, filePath);
}

describe('SymbolExtractor', () => {
  describe('top-level declarations', () => {
    it('extracts class declarations', () => {
      const result = extractSymbols('export class Foo {}');
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'Foo', kind: 'class', exported: true })
      );
    });

    it('extracts interface declarations', () => {
      const result = extractSymbols('export interface Bar { x: number; }');
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'Bar', kind: 'interface', exported: true })
      );
    });

    it('extracts type alias declarations', () => {
      const result = extractSymbols('export type MyType = string | number;');
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MyType', kind: 'type', exported: true })
      );
    });

    it('extracts enum declarations', () => {
      const result = extractSymbols('export enum Color { Red, Green, Blue }');
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'Color', kind: 'enum', exported: true })
      );
    });

    it('extracts const declarations', () => {
      const result = extractSymbols('export const MAX_SIZE = 100;');
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MAX_SIZE', kind: 'const', exported: true })
      );
    });

    it('extracts function declarations', () => {
      const result = extractSymbols('export function doSomething() {}');
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'doSomething', kind: 'function', exported: true })
      );
    });

    it('extracts function metadata for arrow functions assigned to variables', () => {
      const code = `export const MyComponent = (props: Props): string => {
  return props.title;
};`;
      const result = extractSymbols(code);
      const symbol = result.find((s) => s.name === 'MyComponent');

      expect(symbol).toBeDefined();
      expect(symbol).toMatchObject({
        kind: 'function',
        exported: true,
        line: 1,
        endLine: 3,
        parameters: ['props'],
      });
      expect(symbol?.signature).toContain('function MyComponent(props: Props)');
      expect(symbol?.signature).toContain(': string');
    });

    it('extracts all destructured variable bindings', () => {
      const code = `const [state, setState] = useState<string>('');`;
      const result = extractSymbols(code);

      expect(result).toContainEqual(
        expect.objectContaining({ name: 'state', kind: 'const', exported: false })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'setState', kind: 'const', exported: false })
      );
    });
  });

  describe('class members', () => {
    it('extracts class methods', () => {
      const result = extractSymbols('class Foo { bar() {} }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.bar',
          kind: 'method',
          parent: 'Foo',
        })
      );
    });

    it('extracts class properties', () => {
      const result = extractSymbols('class Foo { myProp: string = "hello"; }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.myProp',
          kind: 'property',
          parent: 'Foo',
        })
      );
    });

    it('extracts async methods', () => {
      const result = extractSymbols('class Foo { async fetchData() {} }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.fetchData',
          kind: 'method',
          isAsync: true,
        })
      );
    });

    it('extracts static methods', () => {
      const result = extractSymbols('class Foo { static create() {} }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.create',
          kind: 'method',
          isStatic: true,
        })
      );
    });

    it('extracts static properties', () => {
      const result = extractSymbols('class Foo { static count: number = 0; }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.count',
          kind: 'property',
          isStatic: true,
        })
      );
    });

    it('extracts private methods', () => {
      const result = extractSymbols('class Foo { private doWork() {} }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.doWork',
          kind: 'method',
          visibility: 'private',
        })
      );
    });

    it('extracts protected methods', () => {
      const result = extractSymbols('class Foo { protected init() {} }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.init',
          kind: 'method',
          visibility: 'protected',
        })
      );
    });

    it('extracts private properties', () => {
      const result = extractSymbols('class Foo { private secret: string; }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.secret',
          kind: 'property',
          visibility: 'private',
        })
      );
    });

    it('extracts getters', () => {
      const result = extractSymbols('class Foo { get value() { return 1; } }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.value',
          kind: 'getter',
          parent: 'Foo',
        })
      );
    });

    it('extracts setters', () => {
      const result = extractSymbols('class Foo { set value(v: number) { } }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.value',
          kind: 'setter',
          parent: 'Foo',
        })
      );
    });

    it('extracts method parameters', () => {
      const result = extractSymbols('class Foo { process(a: string, b: number) {} }');
      const method = result.find((s) => s.name === 'Foo.process');
      expect(method).toBeDefined();
      expect(method?.parameters).toEqual(['a', 'b']);
    });

    it('extracts multiple class members', () => {
      const code = `
        class MyClass {
          private data: string;
          public name: string;

          constructor() {}

          async process(input: string): Promise<void> {}

          static create(): MyClass { return new MyClass(); }

          get isReady() { return true; }
          set config(c: any) {}
        }
      `;
      const result = extractSymbols(code);

      expect(result).toContainEqual(expect.objectContaining({ name: 'MyClass', kind: 'class' }));
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MyClass.data', kind: 'property', visibility: 'private' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MyClass.name', kind: 'property', visibility: 'public' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MyClass.process', kind: 'method', isAsync: true })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MyClass.create', kind: 'method', isStatic: true })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MyClass.isReady', kind: 'getter' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'MyClass.config', kind: 'setter' })
      );
    });
  });

  describe('interface members', () => {
    it('extracts interface property signatures', () => {
      const result = extractSymbols('interface Foo { bar: string; }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.bar',
          kind: 'property',
          parent: 'Foo',
        })
      );
    });

    it('extracts interface method signatures', () => {
      const result = extractSymbols('interface Foo { doIt(): void; }');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo.doIt',
          kind: 'method',
          parent: 'Foo',
        })
      );
    });

    it('extracts optional interface properties', () => {
      const result = extractSymbols('interface Config { debug?: boolean; }');
      const prop = result.find((s) => s.name === 'Config.debug');
      expect(prop).toBeDefined();
      expect(prop?.signature).toContain('?');
    });

    it('extracts interface method parameters', () => {
      const result = extractSymbols('interface Service { fetch(url: string): Promise<void>; }');
      const method = result.find((s) => s.name === 'Service.fetch');
      expect(method).toBeDefined();
      expect(method?.parameters).toEqual(['url']);
    });

    it('extracts multiple interface members', () => {
      const code = `
        interface UserService {
          id: string;
          name: string;
          email?: string;

          getProfile(): Promise<User>;
          updateProfile(data: Partial<User>): Promise<void>;
        }
      `;
      const result = extractSymbols(code);

      expect(result).toContainEqual(
        expect.objectContaining({ name: 'UserService', kind: 'interface' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'UserService.id', kind: 'property' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'UserService.name', kind: 'property' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'UserService.email', kind: 'property' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'UserService.getProfile', kind: 'method' })
      );
      expect(result).toContainEqual(
        expect.objectContaining({ name: 'UserService.updateProfile', kind: 'method' })
      );
    });
  });

  describe('signatures', () => {
    it('includes method signature with parameters', () => {
      const result = extractSymbols('class Foo { bar(x: number): string { return ""; } }');
      const method = result.find((s) => s.name === 'Foo.bar');
      expect(method?.signature).toContain('Foo.bar');
      expect(method?.signature).toContain('x: number');
      expect(method?.signature).toContain(': string');
    });

    it('includes property signature with type', () => {
      const result = extractSymbols('class Foo { items: string[] = []; }');
      const prop = result.find((s) => s.name === 'Foo.items');
      expect(prop?.signature).toContain('Foo.items');
      expect(prop?.signature).toContain('string[]');
    });

    it('includes static in property signature', () => {
      const result = extractSymbols('class Foo { static instance: Foo; }');
      const prop = result.find((s) => s.name === 'Foo.instance');
      expect(prop?.signature).toContain('static');
    });

    it('includes async in method signature', () => {
      const result = extractSymbols('class Foo { async load(): Promise<void> {} }');
      const method = result.find((s) => s.name === 'Foo.load');
      expect(method?.signature).toContain('async');
    });
  });

  describe('qualified names', () => {
    it('builds qualified name for class members', () => {
      const result = extractSymbols('class Foo { bar() {} }', 'src/foo.ts');
      const method = result.find((s) => s.name === 'Foo.bar');
      expect(method?.qualifiedName).toBe('src/foo:Foo.bar');
    });

    it('builds qualified name for interface members', () => {
      const result = extractSymbols('interface IFoo { bar: number; }', 'src/types.ts');
      const prop = result.find((s) => s.name === 'IFoo.bar');
      expect(prop?.qualifiedName).toBe('src/types:IFoo.bar');
    });
  });

  describe('line numbers', () => {
    it('extracts correct line numbers for methods', () => {
      const code = `class Foo {
  bar() {}
  baz() {}
}`;
      const result = extractSymbols(code);
      const bar = result.find((s) => s.name === 'Foo.bar');
      const baz = result.find((s) => s.name === 'Foo.baz');
      expect(bar?.line).toBe(2);
      expect(baz?.line).toBe(3);
    });

    it('extracts correct line numbers for interface members', () => {
      const code = `interface IConfig {
  host: string;
  port: number;
}`;
      const result = extractSymbols(code);
      const host = result.find((s) => s.name === 'IConfig.host');
      const port = result.find((s) => s.name === 'IConfig.port');
      expect(host?.line).toBe(2);
      expect(port?.line).toBe(3);
    });
  });

  // ============================================================================
  // RE-EXPORT DETECTION TESTS
  // ============================================================================

  describe('re-export detection', () => {
    it('extracts named re-exports', () => {
      const code = `export { Foo, Bar } from './module';`;
      const result = extractSymbols(code);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Foo',
          kind: 're-export',
          fromModule: './module',
          exported: true,
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Bar',
          kind: 're-export',
          fromModule: './module',
          exported: true,
        })
      );
    });

    it('extracts aliased re-exports', () => {
      const code = `export { Foo as MyFoo } from './module';`;
      const result = extractSymbols(code);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'MyFoo',
          kind: 're-export',
          originalName: 'Foo',
          fromModule: './module',
          exported: true,
        })
      );
    });

    it('extracts barrel exports (export *)', () => {
      const code = `export * from './utils';`;
      const result = extractSymbols(code);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: '* from ./utils',
          kind: 'barrel-export',
          fromModule: './utils',
          exported: true,
        })
      );
    });

    it('extracts multiple re-exports from different modules', () => {
      const code = `
export { A } from './a';
export { B, C } from './b';
export * from './c';
`;
      const result = extractSymbols(code);
      expect(result.filter((s) => s.kind === 're-export')).toHaveLength(3);
      expect(result.filter((s) => s.kind === 'barrel-export')).toHaveLength(1);
    });
  });

  // ============================================================================
  // DECORATOR SUPPORT TESTS
  // ============================================================================

  describe('decorator support', () => {
    it('extracts class decorators', () => {
      const code = `
@Component({ selector: 'app-root' })
export class AppComponent {}
`;
      const result = extractSymbols(code);
      const appComponent = result.find((s) => s.name === 'AppComponent' && s.kind === 'class');
      expect(appComponent).toBeDefined();
      expect(appComponent?.decorators).toContain('Component');
    });

    it('extracts multiple class decorators', () => {
      const code = `
@Injectable()
@Singleton
export class MyService {}
`;
      const result = extractSymbols(code);
      const service = result.find((s) => s.name === 'MyService' && s.kind === 'class');
      expect(service).toBeDefined();
      expect(service?.decorators).toContain('Injectable');
      expect(service?.decorators).toContain('Singleton');
    });

    it('extracts method decorators', () => {
      const code = `
class Controller {
  @Get('/users')
  getUsers() {}

  @Post('/users')
  @Validate
  createUser() {}
}
`;
      const result = extractSymbols(code);
      const getUsers = result.find((s) => s.name === 'Controller.getUsers');
      const createUser = result.find((s) => s.name === 'Controller.createUser');

      expect(getUsers?.decorators).toContain('Get');
      expect(createUser?.decorators).toContain('Post');
      expect(createUser?.decorators).toContain('Validate');
    });

    it('extracts property decorators', () => {
      const code = `
class Entity {
  @Column()
  name: string;

  @Column({ type: 'int' })
  age: number;
}
`;
      const result = extractSymbols(code);
      const nameProp = result.find((s) => s.name === 'Entity.name' && s.kind === 'property');
      const ageProp = result.find((s) => s.name === 'Entity.age' && s.kind === 'property');

      expect(nameProp?.decorators).toContain('Column');
      expect(ageProp?.decorators).toContain('Column');
    });

    it('handles decorators without parentheses', () => {
      const code = `
@Deprecated
class OldClass {}
`;
      const result = extractSymbols(code);
      const oldClass = result.find((s) => s.name === 'OldClass');
      expect(oldClass?.decorators).toContain('Deprecated');
    });
  });

  // ============================================================================
  // DEFAULT EXPORT TESTS
  // ============================================================================

  describe('default export names', () => {
    it('extracts default export with identifier', () => {
      const code = `
const myFunc = () => {};
export default myFunc;
`;
      const result = extractSymbols(code);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'default:myFunc',
          kind: 'default-export',
          exported: true,
        })
      );
    });

    it('extracts default export class declaration', () => {
      const code = `export default class MyClass {}`;
      const result = extractSymbols(code);
      // Should have both the class and the default export entry
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'MyClass',
          kind: 'class',
          exported: true,
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'default:MyClass',
          kind: 'default-export',
          exported: true,
        })
      );
    });

    it('extracts default export function declaration', () => {
      const code = `export default function myFunction() {}`;
      const result = extractSymbols(code);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'myFunction',
          kind: 'function',
          exported: true,
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'default:myFunction',
          kind: 'default-export',
          exported: true,
        })
      );
    });

    it('extracts default export anonymous class', () => {
      const code = `export default class {}`;
      const result = extractSymbols(code, 'myModule.ts');
      // Anonymous default class should use filename
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'default:myModule',
          kind: 'default-export',
          exported: true,
        })
      );
    });

    it('extracts default export arrow function', () => {
      const code = `export default () => { return 42; };`;
      const result = extractSymbols(code, 'calculator.ts');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'default:calculator',
          kind: 'default-export',
          exported: true,
        })
      );
    });

    it('extracts default export object literal', () => {
      const code = `export default { key: 'value' };`;
      const result = extractSymbols(code, 'config.ts');
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'default:config',
          kind: 'default-export',
          exported: true,
        })
      );
    });
  });

  // ============================================================================
  // NAMESPACE SUPPORT TESTS
  // ============================================================================

  describe('namespace support', () => {
    it('extracts namespace declarations', () => {
      const code = `export namespace MyNamespace {}`;
      const result = extractSymbols(code);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'MyNamespace',
          kind: 'namespace',
          exported: true,
        })
      );
    });

    it('extracts namespace members with qualified names', () => {
      const code = `
namespace Utils {
  export interface Config {
    debug: boolean;
  }
  export function log(msg: string) {}
  export const VERSION = '1.0';
}
`;
      const result = extractSymbols(code);

      // Namespace itself
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Utils',
          kind: 'namespace',
        })
      );

      // Members with namespace prefix
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Utils.Config',
          kind: 'interface',
          namespace: 'Utils',
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Utils.log',
          kind: 'function',
          namespace: 'Utils',
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Utils.VERSION',
          kind: 'const',
          namespace: 'Utils',
        })
      );
    });

    it('extracts nested namespace class members', () => {
      const code = `
namespace Models {
  export class User {
    name: string;
    getId(): string { return ''; }
  }
}
`;
      const result = extractSymbols(code);

      // Class with namespace prefix
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Models.User',
          kind: 'class',
          namespace: 'Models',
        })
      );

      // Class members with namespace prefix
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Models.User.name',
          kind: 'property',
          namespace: 'Models',
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'Models.User.getId',
          kind: 'method',
          namespace: 'Models',
        })
      );
    });

    it('extracts namespace interface members', () => {
      const code = `
namespace API {
  export interface Request {
    url: string;
    send(): Promise<Response>;
  }
}
`;
      const result = extractSymbols(code);

      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'API.Request',
          kind: 'interface',
          namespace: 'API',
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'API.Request.url',
          kind: 'property',
          namespace: 'API',
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'API.Request.send',
          kind: 'method',
          namespace: 'API',
        })
      );
    });

    it('extracts module declaration (TypeScript module keyword)', () => {
      const code = `module MyModule { export type ID = string; }`;
      const result = extractSymbols(code);
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'MyModule',
          kind: 'namespace',
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'MyModule.ID',
          kind: 'type',
          namespace: 'MyModule',
        })
      );
    });
  });

  describe('file and directory extraction', () => {
    it('extracts symbols from JavaScript files', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-extractor-js-'));
      const filePath = path.join(tempDir, 'api.js');
      try {
        await fs.writeFile(filePath, 'export function handler(req, res) { return res; }', 'utf8');
        const symbols = await extractSymbolsFromFile(filePath);
        expect(symbols).toContainEqual(
          expect.objectContaining({
            name: 'handler',
            kind: 'function',
            exported: true,
          })
        );
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('extracts symbols from JS/JSX files in directory scans', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-extractor-dir-'));
      try {
        await fs.writeFile(path.join(tempDir, 'index.js'), 'export const VERSION = "1.0";', 'utf8');
        await fs.writeFile(
          path.join(tempDir, 'widget.jsx'),
          'export function Widget() { return <div>Hello</div>; }',
          'utf8'
        );
        await fs.writeFile(path.join(tempDir, 'types.d.ts'), 'export type Ignored = string;', 'utf8');

        const result = await extractSymbolsFromDirectory(tempDir);
        expect(result.filesProcessed).toBe(2);
        expect(result.symbols).toContainEqual(
          expect.objectContaining({
            name: 'VERSION',
            kind: 'const',
            exported: true,
          })
        );
        expect(result.symbols).toContainEqual(
          expect.objectContaining({
            name: 'Widget',
            kind: 'function',
            exported: true,
          })
        );
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('continues batched extraction when one file fails', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-extractor-batch-errors-'));
      try {
        const okA = path.join(tempDir, 'ok_a.ts');
        const okB = path.join(tempDir, 'ok_b.ts');
        const missing = path.join(tempDir, 'missing.ts');

        await fs.writeFile(okA, 'export function alpha() { return 1; }', 'utf8');
        await fs.writeFile(okB, 'export const BETA = 2;', 'utf8');

        const result = await extractSymbolsFromFiles([okA, missing, okB], {
          batchSize: 4,
          includeFunctions: true,
          includeVariables: true,
        });

        expect(result.filesProcessed).toBe(2);
        expect(result.filesWithErrors).toContain(missing);
        expect(result.symbols).toContainEqual(expect.objectContaining({ name: 'alpha', kind: 'function' }));
        expect(result.symbols).toContainEqual(expect.objectContaining({ name: 'BETA', kind: 'const' }));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('matches sequential symbol set when batch extraction is enabled', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-extractor-batch-equivalence-'));
      try {
        const fileA = path.join(tempDir, 'a.ts');
        const fileB = path.join(tempDir, 'b.ts');
        const fileC = path.join(tempDir, 'c.ts');
        await fs.writeFile(fileA, 'export class A { run() { return 1; } }', 'utf8');
        await fs.writeFile(fileB, 'export interface B { id: string; }', 'utf8');
        await fs.writeFile(fileC, 'export function c(value: number) { return value; }', 'utf8');

        const sharedOptions = { includeFunctions: true, includeVariables: true };
        const sequential = await extractSymbolsFromFiles([fileA, fileB, fileC], { ...sharedOptions, batchSize: 1 });
        const batched = await extractSymbolsFromFiles([fileA, fileB, fileC], { ...sharedOptions, batchSize: 20 });

        const toStableKey = (entry: { filePath?: string; name?: string; kind?: string }) =>
          `${entry.filePath ?? ''}:${entry.name ?? ''}:${entry.kind ?? ''}`;

        const sequentialSet = new Set(sequential.symbols.map(toStableKey));
        const batchedSet = new Set(batched.symbols.map(toStableKey));

        expect(batchedSet).toEqual(sequentialSet);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
