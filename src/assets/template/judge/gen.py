# Generator skeleton for `neoj generate`.
#
# neoj runs this program once per test case and writes its standard output to
# the case's `.in` file. The case number arrives as the first argument, so a
# broken case stays reproducible: `random-7` comes from
# `python judge/gen.py 7`.
#
# Add a languages entry that runs Python files when the project does not have
# one yet, and point generate.naive at a correct (not necessarily fast)
# solution that turns the generated input into the expected output:
#
#   [languages.python]
#   source = "**/*.py"
#   run = ["python", "{source}"]
#
#   [generate]
#   gen = "judge/gen.py"
#   naive = "judge/naive.cpp"

import random
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: gen.py <case number>", file=sys.stderr)
        sys.exit(2)

    rng = random.Random(int(sys.argv[1]))

    # TODO: generate one test case and print it. For example:
    #   n = rng.randint(1, 100)
    #   values = [rng.randint(-10**9, 10**9) for _ in range(n)]
    #   print(n)
    #   print(*values)
    print(rng.randint(1, 100))


if __name__ == "__main__":
    main()
