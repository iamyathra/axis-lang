// Real-browser integration proof for the entity/component/system pattern
// (docs/architecture/2026-09-language-platform-audit.md's game-foundation
// addendum, tests/ecs.test.js's own unit-level coverage of the same
// package). tests/ecs.test.js already proves the logic is correct against
// the real evaluator over many synthetic ticks; this proves the same
// composition works end to end over REAL wall-clock time in a real page,
// with real requestAnimationFrame-driven `on tick` firing and a real
// button click triggering destruction - not just that it builds.
//
// harness.js's withPage() runs source through src/run.js directly (no
// module resolution - see its own header), so this can't `import` the
// actual axis_modules/ecs/ package; the entity/component/system pattern is
// inlined instead, deliberately kept identical in shape (same
// makeEntity/makeWorld/runSystems idea, same movement-before-health
// ordering) to what examples/game-foundation/ actually does.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withPage, closeSharedBrowser } from "./harness.js";

const SOURCE = `
  fn makeEntity(name) {
    let e = { name: name, id: 0, components: [] }
    e.add = fn(component) { push(self.components, component) return self }
    e.get = fn(type) { return find(self.components, fn(c) { return c.type == type }) }
    return e
  }

  fn makeWorld() {
    let w = { entities: [], nextId: 1 }
    w.spawn = fn(entity) {
      entity.id = self.nextId
      self.nextId = self.nextId + 1
      push(self.entities, entity)
      return entity
    }
    w.destroy = fn(id) { self.entities = filter(self.entities, fn(e) { return e.id != id }) }
    return w
  }

  fn runSystems(systems, world, dt) {
    for system in systems {
      system(world, dt)
    }
  }

  fn makeTransform(x, y) { return { type: "Transform", x: x, y: y } }
  fn makeVelocity(vx, vy) { return { type: "Velocity", vx: vx, vy: vy } }
  fn makeHealth(value) {
    let h = { type: "Health", value: value }
    h.damage = fn(amount) { self.value = self.value - amount }
    h.isDead = fn() { return self.value <= 0 }
    return h
  }

  fn movementSystem(world, dt) {
    for e in world.entities {
      let t = e.get("Transform")
      let v = e.get("Velocity")
      if (t != null && v != null) {
        t.x = t.x + v.vx * dt
      }
    }
  }

  fn healthSystem(world, dt) {
    for e in world.entities {
      let h = e.get("Health")
      if (h != null && h.isDead()) {
        world.destroy(e.id)
      }
    }
  }

  let world = makeWorld()
  let particle = world.spawn(makeEntity("particle").add(makeTransform(0, 0)).add(makeVelocity(60, 0)).add(makeHealth(100)))

  state posX = 0
  state aliveCount = 1

  page "Game Foundation" {
    text position { content: str(posX) }
    text count { content: str(aliveCount) }
    button hit { label: "kill" }

    on hit.click {
      particle.get("Health").damage(100)
    }

    on tick {
      runSystems([movementSystem, healthSystem], world, dt)
      aliveCount = len(world.entities)
      if (aliveCount > 0) {
        posX = world.entities[0].get("Transform").x
      }
    }
  }
`;

test("an entity's Transform position accumulates strictly across many real ticks, driven by a system - not merely 'changed once'", async () => {
  await withPage(SOURCE, async (page, consoleErrors) => {
    const position = page.locator('[data-axis-name="position"]');
    await position.waitFor({ timeout: 5000 });

    const samples = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(150);
      samples.push(parseFloat(await position.textContent()));
    }

    assert.ok(samples[0] > 0, `expected some movement after the first checkpoint, got ${samples[0]}`);
    assert.ok(samples[1] > samples[0], `expected checkpoint 2 (${samples[1]}) to exceed checkpoint 1 (${samples[0]})`);
    assert.ok(samples[2] > samples[1], `expected checkpoint 3 (${samples[2]}) to exceed checkpoint 2 (${samples[1]})`);
    assert.deepEqual(consoleErrors, []);
  });
});

test("clicking to zero an entity's Health destroys it via a system, and the destruction sticks across many further real ticks", async () => {
  await withPage(SOURCE, async (page, consoleErrors) => {
    const count = page.locator('[data-axis-name="count"]');
    const hit = page.locator('[data-axis-name="hit"]');
    await count.waitFor({ timeout: 5000 });

    assert.equal(await count.textContent(), "1", "expected exactly one entity alive at first");

    await hit.click();

    // Several real frames, not one snapshot - the part that actually rules
    // out "destroyed for a moment, then something re-added it," per this
    // project's own testing philosophy).
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(150);
      assert.equal(await count.textContent(), "0", `expected the entity to remain destroyed at real-time checkpoint ${i}`);
    }
    assert.deepEqual(consoleErrors, []);
  });
});

after(closeSharedBrowser);
