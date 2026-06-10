import os

import pytest

from agent_runner.secure_path import PathDenied, PathPolicy


@pytest.fixture
def root(tmp_path):
    (tmp_path / "work").mkdir()
    (tmp_path / "work" / "secrets").mkdir()
    (tmp_path / "work" / "a.txt").write_text("hello")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "key.txt").write_text("SECRET")
    return tmp_path


@pytest.fixture
def policy(root):
    return PathPolicy([str(root / "work")], [str(root / "work" / "secrets")])


def test_inside_allowed(policy, root):
    assert policy.resolve(str(root / "work" / "a.txt")).read_text() == "hello"


def test_outside_denied(policy, root):
    with pytest.raises(PathDenied):
        policy.resolve(str(root / "outside" / "key.txt"))


def test_dotdot_escape_denied(policy, root):
    with pytest.raises(PathDenied):
        policy.resolve(str(root / "work" / ".." / "outside" / "key.txt"))


def test_blocked_subpath_denied(policy, root):
    (root / "work" / "secrets" / "s.txt").write_text("x")
    with pytest.raises(PathDenied):
        policy.resolve(str(root / "work" / "secrets" / "s.txt"))


def test_symlink_escape_denied(policy, root):
    # allowed_roots 里的符号链接指向外部,realpath 后必须被拒
    link = root / "work" / "sneaky"
    os.symlink(str(root / "outside"), str(link))
    with pytest.raises(PathDenied):
        policy.resolve(str(link / "key.txt"))


def test_symlink_into_blocked_denied(policy, root):
    (root / "work" / "secrets" / "s.txt").write_text("x")
    link = root / "work" / "alias.txt"
    os.symlink(str(root / "work" / "secrets" / "s.txt"), str(link))
    with pytest.raises(PathDenied):
        policy.resolve(str(link))


def test_write_new_file_inside_allowed(policy, root):
    p = policy.resolve(str(root / "work" / "new" / "b.txt"), for_write=True)
    assert str(p).startswith(str(root / "work"))


def test_write_new_file_outside_denied(policy, root):
    with pytest.raises(PathDenied):
        policy.resolve(str(root / "outside" / "new.txt"), for_write=True)


def test_nonexistent_read_denied(policy, root):
    with pytest.raises(PathDenied):
        policy.resolve(str(root / "work" / "missing.txt"))


def test_prefix_sibling_not_confused(root):
    # /tmp/work-evil 不能因字符串前缀匹配 /tmp/work 而放行
    (root / "work-evil").mkdir()
    (root / "work-evil" / "x.txt").write_text("x")
    policy = PathPolicy([str(root / "work")])
    with pytest.raises(PathDenied):
        policy.resolve(str(root / "work-evil" / "x.txt"))


def test_empty_allowed_roots_rejected():
    with pytest.raises(ValueError):
        PathPolicy([])
