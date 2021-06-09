FROM jupyter/minimal-notebook:lab-3.0.16

USER root

RUN sudo apt-get update -y && sudo apt-get install -y slurm-client munge
COPY slurm.conf /etc/slurm-llnl/slurm.conf
# match munge uid/gid from other containers
RUN groupmod -g 997 slurm \
    && usermod -u 999 slurm
RUN chown -R slurm:slurm /var/log/munge && \
    chown -R slurm:slurm /var/lib/munge
RUN mkdir /var/run/munge && chown -R slurm:slurm /var/run/munge

ENV GRANT_SUDO=yes

