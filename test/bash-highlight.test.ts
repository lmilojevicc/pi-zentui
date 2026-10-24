import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { validateBashPaint } from "../extensions/zentui/tool-display/bash-display.js";
import {
	BASH_KIND_ROLES,
	BASH_ROLE_BORROWS,
	BASH_ROLE_ORDER,
	BASH_ROLE_TOKENS,
	BASH_SYNTAX_THEME_TOKENS,
	type BashPaletteTheme,
	type BashToken,
	type BashTokenKind,
	paintBash,
	paintBashBatch,
	resolveBashPalette,
	tokenizeBash,
	tokenizeBashBatch,
} from "../extensions/zentui/tool-display/bash-highlight.js";

const CATPPUCCIN: Record<string, string> = {
	text: "#cdd6f4",
	muted: "#a6adc8",
	dim: "#7f849c",
	accent: "#89b4fa",
	success: "#a6e3a1",
	warning: "#f9e2af",
	error: "#f38ba8",
	syntaxKeyword: "#cba6f7",
	syntaxFunction: "#89b4fa",
	syntaxVariable: "#cdd6f4",
	syntaxString: "#a6e3a1",
	syntaxNumber: "#fab387",
	syntaxType: "#f9e2af",
	syntaxOperator: "#89dceb",
	syntaxPunctuation: "#a6adc8",
	syntaxComment: "#7f849c",
	mdCode: "#fab387",
	mdLink: "#89b4fa",
	mdLinkUrl: "#74c7ec",
	bashMode: "#fab387",
};
const DARK: Record<string, string> = {
	text: "#dee0e1",
	muted: "#9da5a9",
	dim: "#7e888e",
	accent: "#a798d7",
	success: "#68b78d",
	warning: "#cd9a22",
	syntaxKeyword: "#69add0",
	syntaxFunction: "#cd9a22",
	syntaxVariable: "#5db3ba",
	syntaxString: "#de8d5a",
	syntaxNumber: "#68b78d",
	syntaxType: "#a798d7",
	syntaxOperator: "#9da5a9",
	syntaxPunctuation: "#9da5a9",
	syntaxComment: "#9da5a9",
	mdCode: "#a798d7",
	mdLink: "#69add0",
	mdLinkUrl: "#9da5a9",
	bashMode: "#5eb286",
};
const LIGHT: Record<string, string> = {
	text: "#3b3f41",
	muted: "#677176",
	dim: "#879095",
	accent: "#7459b4",
	success: "#337e58",
	warning: "#8f6802",
	syntaxKeyword: "#2f7899",
	syntaxFunction: "#8f6802",
	syntaxVariable: "#287a81",
	syntaxString: "#a45417",
	syntaxNumber: "#337e58",
	syntaxType: "#7459b4",
	syntaxOperator: "#677176",
	syntaxPunctuation: "#677176",
	syntaxComment: "#677176",
	mdCode: "#7459b4",
	mdLink: "#2f7899",
	mdLinkUrl: "#677176",
	bashMode: "#40976c",
};

function openSgr(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}
function tokenTheme(
	tokens: Record<string, string>,
	options: { withColors?: boolean; color?: string } = {},
): BashPaletteTheme {
	const colors = Object.freeze({ ...tokens });
	return {
		...(options.withColors === false ? {} : { colors }),
		getColorMode: () => "truecolor",
		fg(token: string, text: string): string {
			if (options.color) return `${options.color}${text}\x1b[39m`;
			const hex = tokens[token];
			return hex ? `${openSgr(hex)}${text}\x1b[39m` : text;
		},
	};
}

const stripSgr = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const kinds = (command: string): [BashTokenKind, string][] =>
	tokenizeBash(command)
		.filter((token) => token.kind !== "space")
		.map((token) => [token.kind, token.text]);
const join = (command: string) =>
	tokenizeBash(command)
		.map((token) => token.text)
		.join("");

const CORPUS = [
	`git commit -m "msg" && rg -n "foo" src --glob '*.ts'`,
	`FOO=bar curl -sS -X POST --data '{"a":1}' https://x.dev/api | jq .`,
	`find . -name "*.ts" -not -path './node_modules/*' -exec rm -f {} + 2>/dev/null; echo "$?"`,
	`env A=1 B=2 timeout 5 ./run.sh --flag=value -abc`,
	`echo $HOME \${PATH:-x} $(date +%s)`,
	`ls -la | head -3 && diff <(sort a) <(sort b)`,
	`sudo -u root systemctl restart nginx`,
	`xargs -0 rm -f`,
	`if [ -f x ]; then echo yes; else echo no; fi`,
	`for f in *.ts; do printf '%s\\n' "$f"; done`,
	`echo "a b" 'c d' $'e\\tf'`,
	"echo `uname -a`",
	`curl -s https://example.com/path#frag`,
	`git log --oneline --grep='fix #12'`,
	`echo -3 -3.5 1e10 0x10`,
	`cmd -- --not-an-option`,
	`echo 界 👩‍💻 e\u0301`,
	`exec 3>&1`,
	`echo a#b`,
	`# comment only`,
	`echo hi # trailing`,
	`(cd /tmp && ls)`,
	`{ echo a; } | cat`,
	`time -p sleep 1`,
	`nohup ./server &`,
	`A=1 B=2 cmd`,
	`echo "unclosed`,
	`echo $(echo nested $(echo deep))`,
	`echo $((1+2))`,
	`echo ~/x ../y ./z /abs . ..`,
	`docker run --rm -it -p 80:80 nginx:latest /bin/sh -c "echo hi"`,
	`cat <<EOF\nhello $x\nEOF\necho done`,
	`cat <<-'TAB'\n\tbody\n\tTAB\necho done`,
	`rg --hidden --glob '!node_modules' -e "TODO" .`,
	`python3 - <<'PY'\nprint(1)\nPY`,
	`3<<<x`,
	`a=1 b=2; echo $a`,
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Shell parameter expansion.
	"echo ${x%.*}.png",
	`echo a\necho b`,
	`echo\t"tab"\r\necho done`,
	`echo \\\n  continued`,
	`echo "$(printf '%s' "$HOME")"`,
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Shell nested parameter expansion.
	"echo ${A:-${B:-c}}",
	`cat file | while read -r line; do echo "$line"; done`,
	`git diff --stat HEAD~3 -- "*.ts"`,
	`echo a && b || c & d`,
	`case x in a|b) echo hi;; *) echo no;; esac`,
	`for ((i=0;i<3;i++)); do echo $i; done`,
	`[[ -f x && "$y" != z ]]`,
	`! true`,
	`echo a!b`,
	`echo @(a|b) !(c)`,
	`echo http://x/y?a=1#z?q=2`,
	`"$SCRIPT" -x`,
	`'cmd' arg`,
	`X=$(date) cmd`,
	`FOO="bar" cmd --flag`,
	`A=1 B="x y" cmd`,
	`xargs -I{} rm -f`,
	`env -u FOO cmd`,
	`nice -n 10 cmd`,
	`find . -exec rm -f {} +`,
	`cat <<'EOF'\nhello\nEOF\ncat <<-"TAB"\r\n\tbody\r\n\tTAB\r\necho done`,
];

describe("bash-highlight tokenizer", () => {
	it.each(CORPUS)("round-trips every byte: %s", (command) => {
		const tokens = tokenizeBash(command);
		expect(tokens.map((token) => token.text).join("")).toBe(command);
		for (const token of tokens) expect(token.text.length).toBeGreaterThan(0);
	});
	it("round-trips seeded fuzz input without dropping bytes", () => {
		const alphabet = "abc XYZ0123 \n\t\"'`$(){}[]<>&|;=#-/:.,*?!\\";
		let seed = 0x1234567;
		for (let sample = 0; sample < 400; sample++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			const length = seed % 64;
			let command = "";
			for (let index = 0; index < length; index++) {
				seed = (seed * 1103515245 + 12345) & 0x7fffffff;
				command += alphabet[seed % alphabet.length];
			}
			expect(join(command)).toBe(command);
		}
	});
	it.each([
		[
			`"$SCRIPT" -x`,
			[
				["string", '"'],
				["variable", "$SCRIPT"],
				["string", '"'],
				["option", "-x"],
			],
		],
		[
			`'cmd' arg`,
			[
				["string", "'cmd'"],
				["arg", "arg"],
			],
		],
		[
			`X=$(date) cmd`,
			[
				["assignmentName", "X"],
				["assignmentOp", "="],
				["substDelim", "$("],
				["command", "date"],
				["substDelim", ")"],
				["command", "cmd"],
			],
		],
		[
			`FOO="bar" cmd --flag`,
			[
				["assignmentName", "FOO"],
				["assignmentOp", "="],
				["string", '"bar"'],
				["command", "cmd"],
				["option", "--flag"],
			],
		],
		[
			`A=1 B="x y" cmd`,
			[
				["assignmentName", "A"],
				["assignmentOp", "="],
				["number", "1"],
				["assignmentName", "B"],
				["assignmentOp", "="],
				["string", '"x y"'],
				["command", "cmd"],
			],
		],
		[
			`xargs -I{} rm -f`,
			[
				["command", "xargs"],
				["option", "-I"],
				["arg", "{}"],
				["command", "rm"],
				["option", "-f"],
			],
		],
		[
			`env -u FOO cmd`,
			[
				["command", "env"],
				["option", "-u"],
				["arg", "FOO"],
				["command", "cmd"],
			],
		],
		[
			`nice -n 10 cmd`,
			[
				["command", "nice"],
				["option", "-n"],
				["number", "10"],
				["command", "cmd"],
			],
		],
		[
			`sudo -u root cmd`,
			[
				["command", "sudo"],
				["option", "-u"],
				["arg", "root"],
				["command", "cmd"],
			],
		],
		[
			`time -p sleep 1`,
			[
				["keyword", "time"],
				["option", "-p"],
				["command", "sleep"],
				["number", "1"],
			],
		],
		[
			`for ((i=0;i<3;i++)) do echo hi; done`,
			[
				["keyword", "for"],
				["arith", "((i=0;i<3;i++))"],
				["keyword", "do"],
				["builtin", "echo"],
				["arg", "hi"],
				["operator", ";"],
				["keyword", "done"],
			],
		],
		[
			`case x in a) echo a;; esac`,
			[
				["keyword", "case"],
				["arg", "x"],
				["keyword", "in"],
				["arg", "a"],
				["operator", ")"],
				["builtin", "echo"],
				["arg", "a"],
				["operator", ";;"],
				["keyword", "esac"],
			],
		],
		[
			`case x in a) echo esac;; esac`,
			[
				["keyword", "case"],
				["arg", "x"],
				["keyword", "in"],
				["arg", "a"],
				["operator", ")"],
				["builtin", "echo"],
				["arg", "esac"],
				["operator", ";;"],
				["keyword", "esac"],
			],
		],
		[
			`[[ a != b ]]`,
			[
				["keyword", "[["],
				["arg", "a"],
				["operator", "!="],
				["arg", "b"],
				["keyword", "]]"],
			],
		],
		[
			`[[ ! -f x ]]`,
			[
				["keyword", "[["],
				["operator", "!"],
				["arg", "-f"],
				["arg", "x"],
				["keyword", "]]"],
			],
		],
		[
			`! echo hi`,
			[
				["operator", "!"],
				["builtin", "echo"],
				["arg", "hi"],
			],
		],
		[
			`echo a!b`,
			[
				["builtin", "echo"],
				["arg", "a!b"],
			],
		],
		[`@(a|b)`, [["glob", "@(a|b)"]]],
		[
			`echo !(x)`,
			[
				["builtin", "echo"],
				["glob", "!(x)"],
			],
		],
		[
			`echo http://x/y?a=1#z`,
			[
				["builtin", "echo"],
				["arg", "http://x/y?a=1#z"],
			],
		],
		[
			`find . -exec rm -f {} +`,
			[
				["command", "find"],
				["path", "."],
				["option", "-exec"],
				["command", "rm"],
				["option", "-f"],
				["arg", "{}"],
				["arg", "+"],
			],
		],
		[
			`cat <<'EOF'\nhello\nEOF\necho done`,
			[
				["command", "cat"],
				["redirection", "<<"],
				["string", "'EOF'"],
				["heredocBody", "hello\n"],
				["heredocEnd", "EOF\n"],
				["builtin", "echo"],
				["arg", "done"],
			],
		],
		[
			`cat <<-"TAB"\r\n\tbody\r\n\tTAB\r\necho done`,
			[
				["command", "cat"],
				["redirection", "<<-"],
				["string", '"TAB"'],
				["heredocBody", "\tbody\r\n"],
				["heredocEnd", "\tTAB\r\n"],
				["builtin", "echo"],
				["arg", "done"],
			],
		],
		[
			`PATH=$PATH:/usr/local/go/bin go build`,
			[
				["assignmentName", "PATH"],
				["assignmentOp", "="],
				["variable", "$PATH"],
				["path", ":/usr/local/go/bin"],
				["command", "go"],
				["arg", "build"],
			],
		],
		[
			`A=$B/c cmd --x`,
			[
				["assignmentName", "A"],
				["assignmentOp", "="],
				["variable", "$B"],
				["path", "/c"],
				["command", "cmd"],
				["option", "--x"],
			],
		],
		[
			`FOO=bar>baz cmd --x`,
			[
				["assignmentName", "FOO"],
				["assignmentOp", "="],
				["arg", "bar"],
				["redirection", ">"],
				["arg", "baz"],
				["command", "cmd"],
				["option", "--x"],
			],
		],
		[
			`FOO= cmd --flag`,
			[
				["assignmentName", "FOO"],
				["assignmentOp", "="],
				["command", "cmd"],
				["option", "--flag"],
			],
		],
		[
			`A=1 B= cmd`,
			[
				["assignmentName", "A"],
				["assignmentOp", "="],
				["number", "1"],
				["assignmentName", "B"],
				["assignmentOp", "="],
				["command", "cmd"],
			],
		],
		[
			`GIT_PAGER= git log`,
			[
				["assignmentName", "GIT_PAGER"],
				["assignmentOp", "="],
				["command", "git"],
				["arg", "log"],
			],
		],
		[
			`sudo -u root env FOO=1 cmd`,
			[
				["command", "sudo"],
				["option", "-u"],
				["arg", "root"],
				["command", "env"],
				["assignmentName", "FOO"],
				["assignmentOp", "="],
				["number", "1"],
				["command", "cmd"],
			],
		],
		[
			`sudo VAR=value cmd`,
			[
				["command", "sudo"],
				["assignmentName", "VAR"],
				["assignmentOp", "="],
				["arg", "value"],
				["command", "cmd"],
			],
		],
		[
			`time VAR=value cmd`,
			[
				["keyword", "time"],
				["assignmentName", "VAR"],
				["assignmentOp", "="],
				["arg", "value"],
				["command", "cmd"],
			],
		],
		[
			`sudo -iu deploy psql`,
			[
				["command", "sudo"],
				["option", "-iu"],
				["arg", "deploy"],
				["command", "psql"],
			],
		],
		[
			`sudoedit /etc/hosts`,
			[
				["command", "sudoedit"],
				["path", "/etc/hosts"],
			],
		],
		[
			// GNU sudo/env still accept NAME=VALUE after `--`, so `--` ends option parsing
			// but not assignment parsing.
			`sudo -- FOO=1 cmd`,
			[
				["command", "sudo"],
				["option", "--"],
				["assignmentName", "FOO"],
				["assignmentOp", "="],
				["number", "1"],
				["command", "cmd"],
			],
		],
		[
			`env -- FOO=1 cmd`,
			[
				["command", "env"],
				["option", "--"],
				["assignmentName", "FOO"],
				["assignmentOp", "="],
				["number", "1"],
				["command", "cmd"],
			],
		],
		[
			`time nice -n 10 cmd`,
			[
				["keyword", "time"],
				["command", "nice"],
				["option", "-n"],
				["number", "10"],
				["command", "cmd"],
			],
		],
		[
			`env FOO=1 timeout 5 cmd`,
			[
				["command", "env"],
				["assignmentName", "FOO"],
				["assignmentOp", "="],
				["number", "1"],
				["command", "timeout"],
				["number", "5"],
				["command", "cmd"],
			],
		],
		[
			`timeout 5 sudo cmd`,
			[
				["command", "timeout"],
				["number", "5"],
				["command", "sudo"],
				["command", "cmd"],
			],
		],
		[
			`command sudo cmd`,
			[
				["builtin", "command"],
				["command", "sudo"],
				["command", "cmd"],
			],
		],
		[
			`timeout 5 xargs -n1 cmd`,
			[
				["command", "timeout"],
				["number", "5"],
				["command", "xargs"],
				["option", "-n"],
				["number", "1"],
				["command", "cmd"],
			],
		],
		[
			`arr=(one two three)`,
			[
				["assignmentName", "arr"],
				["assignmentOp", "="],
				["operator", "("],
				["arg", "one"],
				["arg", "two"],
				["arg", "three"],
				["operator", ")"],
			],
		],
		[
			`files=(\n src/a.ts\n src/b.ts\n)\nls`,
			[
				["assignmentName", "files"],
				["assignmentOp", "="],
				["operator", "("],
				["path", "src/a.ts"],
				["path", "src/b.ts"],
				["operator", ")"],
				["command", "ls"],
			],
		],
		[
			`arr=(one\ntwo three)`,
			[
				["assignmentName", "arr"],
				["assignmentOp", "="],
				["operator", "("],
				["arg", "one"],
				["arg", "two"],
				["arg", "three"],
				["operator", ")"],
			],
		],
		[
			`local -a arr=(\n a b\n)`,
			[
				["builtin", "local"],
				["option", "-a"],
				["arg", "arr="],
				["operator", "("],
				["arg", "a"],
				["arg", "b"],
				["operator", ")"],
			],
		],
		[
			`local -a arr=(a b)`,
			[
				["builtin", "local"],
				["option", "-a"],
				["arg", "arr="],
				["operator", "("],
				["arg", "a"],
				["arg", "b"],
				["operator", ")"],
			],
		],
		[
			`a=(x); echo \${a[0]}`,
			[
				["assignmentName", "a"],
				["assignmentOp", "="],
				["operator", "("],
				["arg", "x"],
				["operator", ")"],
				["operator", ";"],
				["builtin", "echo"],
				["variable", `\${a[0]}`],
			],
		],
		[
			`coproc cat`,
			[
				["keyword", "coproc"],
				["command", "cat"],
			],
		],
		[
			// Cosmetic limit: the coprocess name occupies the command word slot.
			`coproc NAME { cat; }`,
			[
				["keyword", "coproc"],
				["command", "NAME"],
				["operator", "{"],
				["command", "cat"],
				["operator", ";"],
				["operator", "}"],
			],
		],
		[
			// A case-pattern `)` must not close the surrounding `$(`. The second pattern and
			// its assignment are the discriminator: before the fix `b` was a command.
			`v=$(case $k in a) x=1;; b) x=2;; esac); echo $v`,
			[
				["assignmentName", "v"],
				["assignmentOp", "="],
				["substDelim", "$("],
				["keyword", "case"],
				["variable", "$k"],
				["keyword", "in"],
				["arg", "a"],
				["operator", ")"],
				["assignmentName", "x"],
				["assignmentOp", "="],
				["number", "1"],
				["operator", ";;"],
				["arg", "b"],
				["operator", ")"],
				["assignmentName", "x"],
				["assignmentOp", "="],
				["number", "2"],
				["operator", ";;"],
				["keyword", "esac"],
				["substDelim", ")"],
				["operator", ";"],
				["builtin", "echo"],
				["variable", "$v"],
			],
		],
		[
			// Bash rejects `esac)` at the start of a pattern list, but `a|esac)` is a legal
			// alternation whose second pattern is the word `esac`.
			`case x in a|esac) echo y;; esac`,
			[
				["keyword", "case"],
				["arg", "x"],
				["keyword", "in"],
				["arg", "a"],
				["operator", "|"],
				["arg", "esac"],
				["operator", ")"],
				["builtin", "echo"],
				["arg", "y"],
				["operator", ";;"],
				["keyword", "esac"],
			],
		],
		[
			// `(esac)` opens a pattern list whose entry is the word `esac`.
			`case x in (esac) echo y;; b) z=1;; esac`,
			[
				["keyword", "case"],
				["arg", "x"],
				["keyword", "in"],
				["operator", "("],
				["arg", "esac"],
				["operator", ")"],
				["builtin", "echo"],
				["arg", "y"],
				["operator", ";;"],
				["arg", "b"],
				["operator", ")"],
				["assignmentName", "z"],
				["assignmentOp", "="],
				["number", "1"],
				["operator", ";;"],
				["keyword", "esac"],
			],
		],
		[
			// Bash rejects `esac)` at the start of a pattern list, so `esac` closes the case
			// and the following `)` closes the substitution: `foo` is an argument, not a verb.
			`echo $(case x in a) echo a;; esac) foo`,
			[
				["builtin", "echo"],
				["substDelim", "$("],
				["keyword", "case"],
				["arg", "x"],
				["keyword", "in"],
				["arg", "a"],
				["operator", ")"],
				["builtin", "echo"],
				["arg", "a"],
				["operator", ";;"],
				["keyword", "esac"],
				["substDelim", ")"],
				["arg", "foo"],
			],
		],
		[
			`find . -ok rm {} \\;`,
			[
				["command", "find"],
				["path", "."],
				["option", "-ok"],
				["command", "rm"],
				["arg", "{}"],
				["arg", "\\;"],
			],
		],
		[
			`echo "$(date)"#tail && rm -rf /tmp/x`,
			[
				["builtin", "echo"],
				["string", '"'],
				["substDelim", "$("],
				["command", "date"],
				["substDelim", ")"],
				["string", '"'],
				["arg", "#tail"],
				["operator", "&&"],
				["command", "rm"],
				["option", "-rf"],
				["path", "/tmp/x"],
			],
		],
		[
			`echo $(date)#x`,
			[
				["builtin", "echo"],
				["substDelim", "$("],
				["command", "date"],
				["substDelim", ")"],
				["arg", "#x"],
			],
		],
		[
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Shell parameter expansion.
			"echo ${x}#y",
			[
				["builtin", "echo"],
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Shell parameter expansion.
				["variable", "${x}"],
				["arg", "#y"],
			],
		],
		[
			`echo 'hi'#x`,
			[
				["builtin", "echo"],
				["string", "'hi'"],
				["arg", "#x"],
			],
		],
		[
			`echo \`date\`#x`,
			[
				["builtin", "echo"],
				["substDelim", "`"],
				["command", "date"],
				["substDelim", "`"],
				["arg", "#x"],
			],
		],
		[
			`cat <<E'O'F\nbody\nEOF\nls`,
			[
				["command", "cat"],
				["redirection", "<<"],
				["arg", "E"],
				["string", "'O'"],
				["arg", "F"],
				["heredocBody", "body\n"],
				["heredocEnd", "EOF\n"],
				["command", "ls"],
			],
		],
		[
			`cat <<"E"OF\nbody\nEOF\nls`,
			[
				["command", "cat"],
				["redirection", "<<"],
				["string", '"E"'],
				["arg", "OF"],
				["heredocBody", "body\n"],
				["heredocEnd", "EOF\n"],
				["command", "ls"],
			],
		],
		[
			`cat <<$X\nbody\n$X\necho hi`,
			[
				["command", "cat"],
				["redirection", "<<"],
				["variable", "$X"],
				["heredocBody", "body\n"],
				["heredocEnd", "$X\n"],
				["builtin", "echo"],
				["arg", "hi"],
			],
		],
		[
			`cat <<\\EOF\nbody\nEOF`,
			[
				["command", "cat"],
				["redirection", "<<"],
				["arg", "\\EOF"],
				["heredocBody", "body\n"],
				["heredocEnd", "EOF"],
			],
		],
	])("classifies the known regression case %#", (command, expected) => {
		expect(kinds(command)).toEqual(expected);
	});
	it("keeps a quoted or substituted command word from arming command position", () => {
		for (const command of [`"$SCRIPT" -x`, `'cmd' arg`, `X=$(date) cmd`, `FOO="bar" cmd`]) {
			const commands = tokenizeBash(command).filter((token) => token.kind === "command");
			expect(commands.every((token) => token.text !== "-x" && token.text !== "arg")).toBe(true);
		}
		expect(kinds(`X=$(date) cmd`).at(-1)).toEqual(["command", "cmd"]);
	});
	it("consumes deep nesting at MAX depth without throwing or dropping input", () => {
		const nested = `${"$(".repeat(40)}date${")".repeat(40)}`;
		expect(join(nested)).toBe(nested);
	});
	it("keeps brace-redirection lookahead linear on brace-heavy input", () => {
		const measure = (length: number) => {
			const input = "{ ".repeat(length / 2);
			const start = performance.now();
			const batch = tokenizeBashBatch(input);
			expect(batch.starts.length).toBe(length);
			return performance.now() - start;
		};
		measure(4_000);
		const small = measure(50_000);
		const large = measure(100_000);
		// Quadratic lookahead made 100K take ~4x the 50K time; linear stays near 2x.
		expect(large).toBeLessThan(Math.max(80, small * 3));
		expect(tokenizeBash("{v}>out").map((token) => token.kind)).toEqual(["redirection", "arg"]);
	});
	it("bounds the assignment subscript lookahead", () => {
		for (const [command, expected] of [
			[
				"a[1]=x",
				[
					["assignmentName", "a[1]"],
					["assignmentOp", "="],
					["arg", "x"],
				],
			],
			[
				"a[$i]=x",
				[
					["assignmentName", "a[$i]"],
					["assignmentOp", "="],
					["arg", "x"],
				],
			],
			[
				"a[i+1]=x",
				[
					["assignmentName", "a[i+1]"],
					["assignmentOp", "="],
					["arg", "x"],
				],
			],
			[
				'm["k y"]=v cmd',
				[
					["assignmentName", 'm["k y"]'],
					["assignmentOp", "="],
					["arg", "v"],
					["command", "cmd"],
				],
			],
			[
				"arr[$(x)]=1 cmd",
				[
					["assignmentName", "arr[$(x)]"],
					["assignmentOp", "="],
					["number", "1"],
					["command", "cmd"],
				],
			],
			[
				"declare -A m=([k]=v)",
				[
					["builtin", "declare"],
					["option", "-A"],
					["arg", "m="],
					["operator", "("],
					["glob", "[k]=v"],
					["operator", ")"],
				],
			],
		] as const)
			expect(kinds(command)).toEqual(expected);
		expect(kinds(`a[${"x".repeat(50)}]=1`)).toEqual([
			["assignmentName", `a[${"x".repeat(50)}]`],
			["assignmentOp", "="],
			["number", "1"],
		]);
		// Past the lookahead window the word degrades to one plain command token.
		expect(kinds(`a[${"x".repeat(200)}]=1`)).toEqual([["command", `a[${"x".repeat(200)}]=1`]]);
	});
	it("keeps subscript lookahead linear on unclosed-bracket input", () => {
		const measure = (length: number) => {
			const input = `${"a[;".repeat(length / 3)}b`;
			const start = performance.now();
			tokenizeBashBatch(input);
			return performance.now() - start;
		};
		measure(1_000);
		const median = (length: number) =>
			[measure(length), measure(length), measure(length)].sort(
				(first, second) => first - second,
			)[1];
		const small = median(100_000);
		const large = median(200_000);
		// Unbounded subscript scans made 200K take ~3.9x the 100K time; linear stays near 2x.
		expect(large).toBeLessThan(Math.max(60, small * 3));
	});
	it("keeps a 100KB pathological line linear and lossless", () => {
		const huge = `echo ${"a/b ".repeat(20_000)}`;
		const tokens = tokenizeBash(huge);
		expect(tokens.length).toBeLessThanOrEqual(huge.length);
		expect(tokens.map((token) => token.text).join("")).toBe(huge);
	});
	it("imports no filesystem, process, or path probe modules", () => {
		const source = readFileSync(
			new URL("../extensions/zentui/tool-display/bash-highlight.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toMatch(/from\s+["']node:/);
		expect(source).not.toMatch(/process\.(?:env|platform)|statSync|readdir|existsSync/);
	});
});

describe("bash-highlight palette and paint", () => {
	it("resolves variant A on catppuccin with distinct role colors", () => {
		const palette = resolveBashPalette(tokenTheme(CATPPUCCIN));
		expect(palette.unpainted).toEqual([]);
		expect(palette.roles.verb).toMatchObject({ token: "success", ansi: openSgr("#a6e3a1") });
		expect(palette.roles.keyword).toMatchObject({
			token: "syntaxKeyword",
			ansi: openSgr("#cba6f7"),
		});
		expect(palette.roles.literal).toMatchObject({ token: "warning", ansi: openSgr("#f9e2af") });
		expect(palette.roles.flag).toMatchObject({ token: "syntaxNumber", ansi: openSgr("#fab387") });
		expect(palette.roles.path).toMatchObject({ token: "mdLinkUrl", ansi: openSgr("#74c7ec") });
		expect(palette.roles.variable).toMatchObject({ token: "accent", ansi: openSgr("#89b4fa") });
		expect(palette.roles.structural).toMatchObject({
			token: "syntaxPunctuation",
			ansi: openSgr("#a6adc8"),
		});
		expect(palette.roles.redirect).toMatchObject({
			token: "syntaxOperator",
			ansi: openSgr("#89dceb"),
		});
		expect(palette.roles.quiet).toMatchObject({ token: "syntaxComment", ansi: openSgr("#7f849c") });
		const roles = BASH_ROLE_ORDER.map((role) => palette.roles[role].ansi);
		expect(new Set(roles).size).toBe(roles.length);
	});
	it("borrows redirect/quiet when the theme lacks their primary tokens", () => {
		const theme = tokenTheme({
			...DARK,
			syntaxOperator: undefined as unknown as string,
			dim: "#7e888e",
			syntaxComment: undefined as unknown as string,
		});
		const palette = resolveBashPalette(theme);
		expect(palette.roles.redirect).toMatchObject({ borrowedFrom: "structural" });
		expect(palette.roles.quiet).toMatchObject({ borrowedFrom: "structural" });
		expect(palette.roles.redirect.ansi).toBe(palette.roles.structural.ansi);
	});
	it("never silently repeats a resolved color on a color-poor theme", () => {
		const flat = tokenTheme({ text: "#ffffff", accent: "#ffffff", success: "#ffffff" });
		const palette = resolveBashPalette(flat);
		const painted = BASH_ROLE_ORDER.filter((role) => palette.roles[role].ansi !== undefined);
		// Every candidate collides with the base text color, so nothing is repainted.
		expect(painted).toEqual([]);
		expect(palette.unpainted).toEqual([...BASH_ROLE_ORDER]);
	});
	it("declares every primary and fallback theme token once", () => {
		const candidates = BASH_ROLE_ORDER.flatMap((role) => BASH_ROLE_TOKENS[role]);
		expect(new Set(BASH_SYNTAX_THEME_TOKENS)).toEqual(new Set(candidates));
		expect(BASH_SYNTAX_THEME_TOKENS.length).toBe(new Set(candidates).size);
		expect(Object.keys(BASH_ROLE_BORROWS).sort()).toEqual(["quiet", "redirect"]);
	});
	it("paints only foreground SGR and keeps base arg/space at terminal default", () => {
		const palette = resolveBashPalette(tokenTheme(CATPPUCCIN));
		const tokens = tokenizeBash(`  git commit -m "msg"  `);
		const painted = paintBash(tokens, palette);
		expect(stripSgr(painted)).toBe(`  git commit -m "msg"  `);
		const control = painted.match(/\x1b\[[0-9;]*m/g) ?? [];
		for (const sequence of control)
			expect(sequence).toMatch(
				/^\x1b\[(?:3[0-7]|9[0-7]|39|38;5;\d{1,3}|38;2;\d{1,3};\d{1,3};\d{1,3})m$/,
			);
		expect(painted).not.toMatch(/\x1b\[(?:4[0-9]|49|1|2|3|7|9)m/);
		// Whitespace stays outside every colour run and no run spans whitespace: a colour
		// change is emitted at the start of a word, never between a word and the space that
		// follows it, so pi-tui keeps every whitespace token escape-free and wraps exactly
		// like the uncolored row. A run covers its whole word (no terminal-default gap).
		expect(painted.startsWith("  ")).toBe(true);
		expect(stripSgr(painted).endsWith('"  ')).toBe(true);
		expect(painted).not.toMatch(/^(?:\x1b\[[0-9;]*m)+ /);
		expect(painted).not.toMatch(/\x1b\[39m[ \t]/);
		// `git` is painted in full, including its last grapheme.
		expect(painted).toContain(`git `);
		expect(painted).not.toContain(`gi\x1b[39mt`);
		// `commit` is a plain argument: it is not painted, so the reset before it belongs to
		// closing `git` and `commit` itself stays at the terminal default.
		expect(painted).toContain("\x1b[39mcommit ");
		expect(painted).not.toContain("\x1b[38;2;166;227;161mcommit");
		// One color run per colored word, not one per token.
		expect((painted.match(/\x1b\[38;2;/g) ?? []).length).toBeLessThanOrEqual(4);
		const commit: BashToken = tokens.find((token) => token.text === "commit") as BashToken;
		expect(BASH_KIND_ROLES[commit.kind]).toBeNull();
	});
	it("keeps every painted byte grapheme-safe across themes", () => {
		const command = `printf '界 👩‍💻 e\u0301' && echo "a b"`;
		const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
		for (const theme of [CATPPUCCIN, DARK, LIGHT]) {
			const palette = resolveBashPalette(tokenTheme(theme));
			const painted = paintBash(tokenizeBash(command), palette);
			expect(stripSgr(painted)).toBe(command);
			expect(visibleWidth(painted)).toBe(visibleWidth(command));
			const boundaries = new Set([command.length]);
			for (const segment of segmenter.segment(command)) boundaries.add(segment.index);
			let escapes = 0;
			for (const match of painted.matchAll(/\x1b\[[0-9;]*m/g)) {
				expect(boundaries.has((match.index as number) - escapes)).toBe(true);
				escapes += match[0].length;
			}
			expect(painted.split("\n").length).toBe(command.split("\n").length);
		}
	});
	it("never places an opening SGR directly before whitespace", () => {
		const palette = resolveBashPalette(tokenTheme(CATPPUCCIN));
		for (const command of CORPUS) {
			const painted = paintBash(tokenizeBash(command), palette);
			expect(painted).not.toMatch(/\x1b\[38;[0-9;]*m[ \t\n]/);
			expect(painted).not.toMatch(/\x1b\[38;[0-9;]*m$/);
		}
	});
	it("leaves tokens unpainted when no role color is available", () => {
		const palette = resolveBashPalette(tokenTheme({ text: "#ffffff" }));
		const command = `git commit -m "x" > /tmp/y`;
		expect(paintBash(tokenizeBash(command), palette)).toBe(command);
		expect(palette.usedTokens).toEqual([]);
	});
	it("uses the terminal-default sample without emitting a stray opening SGR", () => {
		const palette = resolveBashPalette({
			fg: (token: string, text: string) =>
				token === "accent" ? `\x1b[39m${text}` : `\x1b[38;5;${token.length}m${text}\x1b[39m`,
		});
		for (const role of BASH_ROLE_ORDER) {
			const ansi = palette.roles[role].ansi;
			expect(ansi === undefined || /^\x1b\[(?:38;5;\d{1,3})m$/.test(ansi)).toBe(true);
		}
	});
});

describe("bash-display paint validation", () => {
	it.each([
		"e\u0301",
		"👩‍💻",
		"🇯🇵🇺🇸",
		"\u1100\u1161",
		"界 👩‍💻 e\u0301",
		" \u0e33",
		"\u0600x",
		"👍🏽",
		"a\r\nb",
		"x\u0308\u0301y",
	])("accepts an inserted SGR exactly at a grapheme boundary: %j", (text) => {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
		const boundaries = new Set([0, text.length]);
		for (const segment of segmenter.segment(text)) boundaries.add(segment.index);
		for (let index = 0; index <= text.length; index++) {
			const painted = `${text.slice(0, index)}\x1b[38;5;1m${text.slice(index)}`;
			expect(validateBashPaint(text, painted) !== undefined).toBe(boundaries.has(index));
		}
	});
	it("rejects an SGR inside a cluster but accepts it between clusters", () => {
		expect(validateBashPaint("e\u0301", "e\x1b[38;5;1m\u0301")).toBeUndefined();
		expect(validateBashPaint(" \u0e33", " \x1b[38;5;1m\u0e33")).toBeUndefined();
		expect(validateBashPaint("\u0600x", "\u0600\x1b[38;5;1mx")).toBeUndefined();
		expect(validateBashPaint("x — y", "x \x1b[38;5;1m— y")).toBeDefined();
		// Relocation is opt-in: moving a valid leading SGR over the space would put it
		// inside the spacing-mark cluster and corrupt the row.
		expect(validateBashPaint(" \u0e33", "\x1b[38;5;1m \u0e33")).toBeDefined();
		expect(validateBashPaint(" \u0e33", "\x1b[38;5;1m \u0e33", { relocate: true })).toBeUndefined();
	});
	it.each(["ab", "éab"])("bounds 256-color channels above 255 for %j", (display) => {
		expect(validateBashPaint(display, `\x1b[38;5;256m${display}\x1b[39m`)).toBeUndefined();
		expect(validateBashPaint(display, `\x1b[38;5;259m${display}\x1b[39m`)).toBeUndefined();
		expect(validateBashPaint(display, `\x1b[38;5;255m${display}\x1b[39m`)).toBe(
			`\x1b[38;5;255m${display}\x1b[39m`,
		);
		expect(validateBashPaint(display, `\x1b[38;5;0m${display}\x1b[39m`)).toBe(
			`\x1b[38;5;0m${display}\x1b[39m`,
		);
	});
	it("validates a cold non-ASCII row with one segmenter pass and few lookups", () => {
		const palette = resolveBashPalette(tokenTheme(CATPPUCCIN));
		const command = `echo 界界界 ${"a".repeat(1800)} — 界 tail`;
		const painted = paintBashBatch(tokenizeBashBatch(command), palette);
		expect(stripSgr(painted)).toBe(command);
		const segmentsPrototype = Object.getPrototypeOf(
			new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment("ab"),
		);
		const containing = vi.spyOn(segmentsPrototype, "containing");
		const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
		try {
			expect(validateBashPaint(command, painted)).toBeDefined();
			expect(segment.mock.calls.length).toBeLessThanOrEqual(1);
			expect(containing.mock.calls.length).toBeLessThanOrEqual(2);
		} finally {
			vi.restoreAllMocks();
		}
	});
});
