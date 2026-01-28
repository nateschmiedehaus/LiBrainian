/**
 * @fileoverview Tests for Java parser support via tree-sitter-java
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ParserRegistry } from '../parser_registry.js';

describe('Java Parser (tree-sitter-java)', () => {
  let registry: ParserRegistry;

  beforeAll(() => {
    registry = ParserRegistry.getInstance();
  });

  describe('Parser registration', () => {
    it('should register .java extension', () => {
      const extensions = registry.getSupportedExtensions();
      expect(extensions).toContain('.java');
    });
  });

  describe('Simple class parsing', () => {
    const simpleClass = `
package com.example;

import java.util.List;
import java.util.ArrayList;

public class Calculator {
    private int value;

    public Calculator() {
        this.value = 0;
    }

    public int add(int a, int b) {
        return a + b;
    }

    public int getValue() {
        return value;
    }
}
`;

    it('should parse Java file without throwing', () => {
      expect(() => registry.parseFile('Calculator.java', simpleClass)).not.toThrow();
    });

    it('should return parser name containing java', () => {
      const result = registry.parseFile('Calculator.java', simpleClass);
      expect(result.parser).toContain('java');
    });

    it('should extract class declaration', () => {
      const result = registry.parseFile('Calculator.java', simpleClass);
      const classDecl = result.functions.find((f) => f.name === 'Calculator');
      expect(classDecl).toBeDefined();
    });

    it('should extract method declarations', () => {
      const result = registry.parseFile('Calculator.java', simpleClass);
      const addMethod = result.functions.find((f) => f.name === 'add');
      expect(addMethod).toBeDefined();
    });

    it('should extract constructor', () => {
      const result = registry.parseFile('Calculator.java', simpleClass);
      // Constructor is typically named same as class or has constructor in name
      const hasConstructor = result.functions.some(
        (f) => f.name === 'Calculator' || f.signature.includes('Calculator()')
      );
      expect(hasConstructor).toBe(true);
    });

    it('should extract import statements as dependencies', () => {
      const result = registry.parseFile('Calculator.java', simpleClass);
      expect(result.module.dependencies).toContain('java.util.List');
      expect(result.module.dependencies).toContain('java.util.ArrayList');
    });
  });

  describe('Method signature extraction', () => {
    const methodsClass = `
public class Methods {
    public String greet(String name) {
        return "Hello, " + name;
    }

    public int calculate(int x, int y, boolean multiply) {
        return multiply ? x * y : x + y;
    }

    private void doNothing() {
    }

    protected static void helper(int[] values) {
    }
}
`;

    it('should extract method with parameters', () => {
      const result = registry.parseFile('Methods.java', methodsClass);
      const greetMethod = result.functions.find((f) => f.name === 'greet');
      expect(greetMethod).toBeDefined();
      expect(greetMethod?.signature).toContain('greet');
    });

    it('should extract method with multiple parameters', () => {
      const result = registry.parseFile('Methods.java', methodsClass);
      const calcMethod = result.functions.find((f) => f.name === 'calculate');
      expect(calcMethod).toBeDefined();
    });

    it('should extract void methods', () => {
      const result = registry.parseFile('Methods.java', methodsClass);
      const voidMethod = result.functions.find((f) => f.name === 'doNothing');
      expect(voidMethod).toBeDefined();
    });

    it('should provide line number information', () => {
      const result = registry.parseFile('Methods.java', methodsClass);
      const greetMethod = result.functions.find((f) => f.name === 'greet');
      expect(greetMethod?.startLine).toBeGreaterThan(0);
      expect(greetMethod?.endLine).toBeGreaterThanOrEqual(greetMethod?.startLine ?? 0);
    });
  });

  describe('Interface parsing', () => {
    const interfaceCode = `
package com.example;

public interface Repository<T> {
    T findById(long id);
    List<T> findAll();
    void save(T entity);
    void delete(T entity);
}
`;

    it('should extract interface declaration', () => {
      const result = registry.parseFile('Repository.java', interfaceCode);
      const interfaceDecl = result.functions.find((f) => f.name === 'Repository');
      expect(interfaceDecl).toBeDefined();
    });

    it('should extract interface methods', () => {
      const result = registry.parseFile('Repository.java', interfaceCode);
      const findById = result.functions.find((f) => f.name === 'findById');
      expect(findById).toBeDefined();
    });
  });

  describe('Annotation handling', () => {
    const annotatedClass = `
package com.example;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class UserService {
    @Autowired
    private UserRepository repository;

    @Override
    public String toString() {
        return "UserService";
    }

    @Deprecated
    public void oldMethod() {
    }
}
`;

    it('should parse class with annotations without error', () => {
      expect(() => registry.parseFile('UserService.java', annotatedClass)).not.toThrow();
    });

    it('should extract annotated methods', () => {
      const result = registry.parseFile('UserService.java', annotatedClass);
      const toStringMethod = result.functions.find((f) => f.name === 'toString');
      expect(toStringMethod).toBeDefined();
    });

    it('should extract imports from annotated class', () => {
      const result = registry.parseFile('UserService.java', annotatedClass);
      expect(result.module.dependencies).toContain('org.springframework.stereotype.Service');
      expect(result.module.dependencies).toContain('org.springframework.beans.factory.annotation.Autowired');
    });
  });

  describe('Complex class features', () => {
    const complexClass = `
package com.example.domain;

import java.util.*;
import java.io.Serializable;

/**
 * A complex entity class.
 */
public class Entity implements Serializable, Comparable<Entity> {
    private static final long serialVersionUID = 1L;
    private final String id;
    private String name;

    public Entity(String id) {
        this.id = id;
    }

    public Entity(String id, String name) {
        this.id = id;
        this.name = name;
    }

    @Override
    public int compareTo(Entity other) {
        return this.id.compareTo(other.id);
    }

    public static Entity create(String id) {
        return new Entity(id);
    }

    public class InnerEntity {
        private String innerField;

        public String getInnerField() {
            return innerField;
        }
    }
}
`;

    it('should parse class implementing interfaces', () => {
      expect(() => registry.parseFile('Entity.java', complexClass)).not.toThrow();
    });

    it('should extract multiple constructors', () => {
      const result = registry.parseFile('Entity.java', complexClass);
      // Should find constructors (may be named Entity or have constructor-like signature)
      const constructors = result.functions.filter(
        (f) => f.name === 'Entity' && f.signature.includes('(')
      );
      // At least class declaration and possibly constructors
      expect(constructors.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract static methods', () => {
      const result = registry.parseFile('Entity.java', complexClass);
      const createMethod = result.functions.find((f) => f.name === 'create');
      expect(createMethod).toBeDefined();
    });

    it('should extract inner class', () => {
      const result = registry.parseFile('Entity.java', complexClass);
      const innerClass = result.functions.find((f) => f.name === 'InnerEntity');
      expect(innerClass).toBeDefined();
    });

    it('should extract inner class methods', () => {
      const result = registry.parseFile('Entity.java', complexClass);
      const innerMethod = result.functions.find((f) => f.name === 'getInnerField');
      expect(innerMethod).toBeDefined();
    });
  });

  describe('Enum parsing', () => {
    const enumCode = `
package com.example;

public enum Status {
    PENDING,
    ACTIVE,
    COMPLETED;

    public boolean isTerminal() {
        return this == COMPLETED;
    }
}
`;

    it('should parse enum without error', () => {
      expect(() => registry.parseFile('Status.java', enumCode)).not.toThrow();
    });

    it('should extract enum declaration', () => {
      const result = registry.parseFile('Status.java', enumCode);
      const enumDecl = result.functions.find((f) => f.name === 'Status');
      expect(enumDecl).toBeDefined();
    });

    it('should extract enum methods', () => {
      const result = registry.parseFile('Status.java', enumCode);
      const enumMethod = result.functions.find((f) => f.name === 'isTerminal');
      expect(enumMethod).toBeDefined();
    });
  });

  describe('Abstract class and methods', () => {
    const abstractClass = `
package com.example;

public abstract class Shape {
    protected String color;

    public abstract double area();
    public abstract double perimeter();

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }
}
`;

    it('should parse abstract class', () => {
      expect(() => registry.parseFile('Shape.java', abstractClass)).not.toThrow();
    });

    it('should extract abstract methods', () => {
      const result = registry.parseFile('Shape.java', abstractClass);
      const areaMethod = result.functions.find((f) => f.name === 'area');
      expect(areaMethod).toBeDefined();
    });

    it('should extract concrete methods in abstract class', () => {
      const result = registry.parseFile('Shape.java', abstractClass);
      const getColorMethod = result.functions.find((f) => f.name === 'getColor');
      expect(getColorMethod).toBeDefined();
    });
  });
});
