# Your first problem

This tutorial takes you from an empty directory to sample tests on disk. It takes
a few minutes and uses AtCoder, one of the platforms `neoj` ships with.

## Before you start

- [Install `neoj`](how-to/install.md). It requires Bun 1.4 or newer.
- You do not need an AtCoder account to download samples from a public problem.

## 1. Create a project

```bash
mkdir my-first-problem
cd my-first-problem
neoj init
```

`neoj init` copies the bundled starter files into the directory:

| Path                | Contents                                                   |
| ------------------- | ---------------------------------------------------------- |
| `neoj.toml`         | Project configuration.                                     |
| `src/main.cpp`      | Starter source file.                                       |
| `template/main.cpp` | Solution template that is applied after every download.    |
| `.gitignore`        | Ignores `test/`, `.neoj/`, and editor or dependency files. |

The bundled configuration enables templates, so the next step also copies
`template/main.cpp` over `src/main.cpp`.

## 2. Download the samples

```bash
neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a
```

yukicoder problem URLs work the same way:

```bash
neoj d https://yukicoder.me/problems/no/480
```

`neoj` fetches the problem, writes each sample into `test/`, and records the
problem in `.neoj/problem.json`.

## 3. Check the result

```bash
ls test
```

The folder now contains one input and one output file per sample:

```
test/
├── sample-1.in
├── sample-1.out
└── ...
```

Open an input file and compare it with the problem page, then write your solution
in `src/main.cpp`.

## 4. Where to go next

- [Change the test folder or file names](how-to/configure-project.md).
- [Log in](how-to/manage-sessions.md) if a problem requires an account.
- [Look up every command and flag](reference/cli.md).
