import { describe, expect, it } from "bun:test";
import { scrubIdentifiers } from "../src/services/spaces/identifier-scrub.js";

describe("scrubIdentifiers: home-folder paths", () => {
  it("rewrites a macOS home path to the tilde form", () => {
    const result = scrubIdentifiers("the config is in /Users/jo/work/app/config.json");
    expect(result.text).toBe("the config is in ~/work/app/config.json");
    expect(result.counts).toEqual({ pathsReplaced: 1, emailsReplaced: 0 });
  });

  it("rewrites a Linux home path to the tilde form", () => {
    const result = scrubIdentifiers("check /home/sam/logs/app.log for errors");
    expect(result.text).toBe("check ~/logs/app.log for errors");
    expect(result.counts.pathsReplaced).toBe(1);
  });

  it("rewrites a Windows home path and keeps the backslashes", () => {
    const result = scrubIdentifiers("run C:\\Users\\sam\\tools\\build.bat");
    expect(result.text).toBe("run ~\\tools\\build.bat");
    expect(result.counts.pathsReplaced).toBe(1);
  });

  it("accepts any drive letter in either case", () => {
    expect(scrubIdentifiers("d:\\Users\\sam\\notes.txt").text).toBe("~\\notes.txt");
    expect(scrubIdentifiers("D:\\Users\\sam\\notes.txt").text).toBe("~\\notes.txt");
  });

  it("accepts forward slashes in a Windows home path", () => {
    const result = scrubIdentifiers("run C:/Users/sam/tools/build.bat");
    expect(result.text).toBe("run ~/tools/build.bat");
    expect(result.counts.pathsReplaced).toBe(1);
  });

  it("rewrites a path at the end of the string", () => {
    const result = scrubIdentifiers("run it from /Users/jo/tools/run.sh");
    expect(result.text).toBe("run it from ~/tools/run.sh");
    expect(result.counts.pathsReplaced).toBe(1);
  });

  it("rewrites a path inside quotes", () => {
    const result = scrubIdentifiers('open "/Users/jo/work/app" and edit');
    expect(result.text).toBe('open "~/work/app" and edit');
    expect(result.counts.pathsReplaced).toBe(1);
  });

  it("collapses a bare home folder to a tilde", () => {
    expect(scrubIdentifiers("start in /Users/jo").text).toBe("start in ~");
    expect(scrubIdentifiers("start in /home/jo").text).toBe("start in ~");
  });

  it("counts several paths in one string", () => {
    const result = scrubIdentifiers("from /Users/jo/a.txt to /home/sam/b.txt");
    expect(result.text).toBe("from ~/a.txt to ~/b.txt");
    expect(result.counts.pathsReplaced).toBe(2);
  });
});

describe("scrubIdentifiers: email addresses", () => {
  it("replaces an email with the placeholder", () => {
    const result = scrubIdentifiers("ask jo@example.org");
    expect(result.text).toBe("ask <email>");
    expect(result.counts).toEqual({ pathsReplaced: 0, emailsReplaced: 1 });
  });

  it("replaces an email inside parentheses", () => {
    const result = scrubIdentifiers("contact (sam.team@example.co.uk) today");
    expect(result.text).toBe("contact (<email>) today");
    expect(result.counts.emailsReplaced).toBe(1);
  });

  it("keeps the sentence period after an email", () => {
    expect(scrubIdentifiers("mail a@x.com.").text).toBe("mail <email>.");
  });

  it("counts several emails in one string", () => {
    const result = scrubIdentifiers("a@x.com wrote to b@y.org");
    expect(result.text).toBe("<email> wrote to <email>");
    expect(result.counts.emailsReplaced).toBe(2);
  });
});

describe("scrubIdentifiers: private regions", () => {
  it("removes a private region without counting what was inside", () => {
    const result = scrubIdentifiers("token <private>/Users/jo/keys and jo@x.com</private> stays");
    expect(result.text).toBe("token [REDACTED] stays");
    expect(result.counts).toEqual({ pathsReplaced: 0, emailsReplaced: 0 });
  });

  it("scrubs the text around a private region", () => {
    const result = scrubIdentifiers("keep /Users/jo/a <private>jo@x.com</private> end");
    expect(result.text).toBe("keep ~/a [REDACTED] end");
    expect(result.counts.pathsReplaced).toBe(1);
    expect(result.counts.emailsReplaced).toBe(0);
  });
});

describe("scrubIdentifiers: conservative scope", () => {
  it("leaves text without identifiers unchanged", () => {
    const input = "The build passed on the CI runner.";
    const result = scrubIdentifiers(input);
    expect(result.text).toBe(input);
    expect(result.counts).toEqual({ pathsReplaced: 0, emailsReplaced: 0 });
  });

  it("leaves system paths alone", () => {
    const input = "install it under /usr/local/bin and /etc";
    const result = scrubIdentifiers(input);
    expect(result.text).toBe(input);
    expect(result.counts.pathsReplaced).toBe(0);
  });

  it("leaves URL paths alone", () => {
    const input = "see https://example.com/home/jo/page";
    const result = scrubIdentifiers(input);
    expect(result.text).toBe(input);
    expect(result.counts.pathsReplaced).toBe(0);
  });

  it("leaves a home root without a user name alone", () => {
    const input = "list the /Users/ folder";
    const result = scrubIdentifiers(input);
    expect(result.text).toBe(input);
    expect(result.counts.pathsReplaced).toBe(0);
  });
});
