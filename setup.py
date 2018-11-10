from distutils.core import setup
from setuptools import find_packages

setup(
    name='jupyterlab-slurm',
    version='0.1.0',
    description='A Jupyter Notebook server extension to interface with common Slurm commands.',
    packages=find_packages(),
    author='Jon Hays, William Krinsman, NERSC',
    license='BSD 3-Clause',
    long_description=open('README.md').read(),
    install_requires=[
        'notebook'
        ],
)
