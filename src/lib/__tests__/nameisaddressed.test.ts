import { describe, it, expect } from "vitest";
import { nameIsAddressed } from "../llm";

describe("nameIsAddressed", () => {
  it("flags a name used to greet/address someone (not the customer's own name)", () => {
    expect(nameIsAddressed("Hey digvijay! If I pay the registration fee...", "Digvijay")).toBe(true);
    expect(nameIsAddressed("Hi Maya, what are the fees?", "Maya")).toBe(true);
    expect(nameIsAddressed("hello Rohan can you help", "Rohan")).toBe(true);
    expect(nameIsAddressed("thanks Priya", "Priya")).toBe(true);
    expect(nameIsAddressed("dear sir Rahul", "Rahul")).toBe(true);
  });

  it("does NOT flag a genuine self-introduction", () => {
    expect(nameIsAddressed("my name is Riya", "Riya")).toBe(false);
    expect(nameIsAddressed("I'm Rohan from Delhi", "Rohan")).toBe(false);
    expect(nameIsAddressed("this is Karan, interested in data science", "Karan")).toBe(false);
  });

  it("is case-insensitive and ignores unrelated names", () => {
    expect(nameIsAddressed("HEY DIGVIJAY!", "digvijay")).toBe(true);
    expect(nameIsAddressed("Hey Maya", "Digvijay")).toBe(false);
    expect(nameIsAddressed("", "Digvijay")).toBe(false);
    expect(nameIsAddressed("Hey there", "")).toBe(false);
  });
});
