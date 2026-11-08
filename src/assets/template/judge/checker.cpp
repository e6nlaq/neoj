// Checker skeleton for `neoj test --judge`.
//
// neoj runs this program after your solution exits:
//   - the solution's standard output arrives on this program's standard input
//   - the test case path is passed as the first argument when `{infile}` is
//     present in test.judge.run
//
// Exit with status 0 to accept the output; a non-zero status rejects it. The
// first non-empty line written to standard error becomes the `WA (...)` reason.
// This example accepts any ordering of the input numbers, so several outputs
// can be correct.
#include <bits/stdc++.h>

using namespace std;

int main(int argc, char** argv) {
    if (argc < 2) {
        cerr << "usage: " << argv[0] << " <input file>\n";
        return 2;
    }

    ifstream input(argv[1]);
    if (!input) {
        cerr << "cannot open " << argv[1] << '\n';
        return 2;
    }

    int n = 0;
    input >> n;
    multiset<long long> remaining;
    for (int index = 0; index < n; index += 1) {
        long long value = 0;
        input >> value;
        remaining.insert(value);
    }

    vector<long long> answer;
    long long value = 0;
    while (cin >> value) {
        answer.push_back(value);
    }

    if (static_cast<int>(answer.size()) != n) {
        cerr << "expected " << n << " numbers, got " << answer.size() << '\n';
        return 1;
    }

    for (const long long candidate : answer) {
        const auto found = remaining.find(candidate);
        if (found == remaining.end()) {
            cerr << "unexpected value " << candidate << '\n';
            return 1;
        }
        remaining.erase(found);
    }

    return 0;
}
