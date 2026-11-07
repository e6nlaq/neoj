// Interactor skeleton for `neoj test --interactive`.
//
// neoj starts this program next to your solution and connects them with pipes:
//   - the solution's standard output arrives on this program's standard input
//   - everything written here to standard output goes to the solution
//
// Exit with status 0 to accept the solution; a non-zero status rejects it. The
// first non-empty line written to standard error becomes the `WA (...)` reason.
// The test case path is passed as the first argument because the example in
// neoj.toml puts {infile} in test.interactor.run.
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

    // TODO: read the secret input and send the first question.
    long long a = 0;
    long long b = 0;
    input >> a >> b;
    cout << a << ' ' << b << endl;

    // TODO: read the solution's answer and check it.
    long long sum = 0;
    long long product = 0;
    cin >> sum >> product;

    if (sum == a + b && product == a * b) {
        return 0;
    }

    cerr << "wrong answer: expected " << (a + b) << ' ' << (a * b) << ", got " << sum << ' '
         << product << '\n';
    return 1;
}
