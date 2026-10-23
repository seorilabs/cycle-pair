"""서명된 test host 전체를 같은 정의로 결속한다. 내용은 출력하지 않는다."""
import hashlib
import pathlib


def tree_sha256(root):
    root = pathlib.Path(root)
    digest = hashlib.sha256()
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root).as_posix().encode()
        if file.is_symlink():
            raise ValueError('test host symlink is not supported')
        if file.is_file():
            digest.update(relative + b'\0')
            digest.update(hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()
