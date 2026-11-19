import unittest

from src.main import greet


class GreetTest(unittest.TestCase):
    def test_greet(self) -> None:
        self.assertEqual(greet("locus"), "hello, locus")


if __name__ == "__main__":
    unittest.main()
