from setuptools import setup

setup(
    name="weave-cli",
    version="0.1.0",
    py_modules=["weave"],
    install_requires=["openai>=1.0"],
    entry_points={
        "console_scripts": [
            "weave=weave:main",
        ],
    },
)
