# JupyterHub + JupyterLab image that talks to the local slurm-docker-cluster
# stand-in over the real Slurm client tools (sbatch/squeue/scontrol/sacct/
# scancel), authenticated via munge against the shared cluster munge.key --
# NOT via docker-exec-as-root wrapper scripts. This lets each Hub-spawned
# single-user server run the jupyterlab-slurm extension as its own real OS
# user, so cross-user authorization / identity-mapping can be tested
# end-to-end through the extension itself.
#
# The Slurm client RPMs themselves are not built here nor committed to this
# repo: the upstream slurm-docker-cluster image (built by `docker/cluster.sh
# up`, see docker/README.md) already builds them from source and caches them
# at /var/cache/slurm-rpms/ in its runtime image, so this build just reuses
# that local image as a build stage and installs the same RPMs -- no
# extraction/tarball step required, and it stays in sync with whatever
# SLURM_VERSION the cluster is running.
ARG SLURM_VERSION=26.05.2
FROM slurm-docker-cluster:${SLURM_VERSION} AS slurm-rpms

FROM rockylinux:9

# munge (from EPEL) provides the authentication daemon the Slurm client
# binaries need to talk to slurmctld/slurmdbd on the shared munge.key.
RUN dnf -y install epel-release && \
    dnf -y install \
      munge munge-libs \
      python3 python3-pip python3-devel \
      nodejs npm \
      shadow-utils sudo which procps-ng \
      gcc make && \
    dnf clean all

# Install the same Slurm client RPMs the cluster containers run, straight
# from the locally built slurm-docker-cluster image (see above).
COPY --from=slurm-rpms /var/cache/slurm-rpms /tmp/rpms
RUN dnf -y install /tmp/rpms/*.rpm && rm -rf /tmp/rpms

ENV PATH="/usr/bin:${PATH}"

# JupyterHub, single-user JupyterLab, and the jupyterlab-slurm extension.
# tornado is pinned below 6.5.9: that release introduced a regression
# where several StaticFileHandler subclasses (e.g. jupyter_server's
# ThemesHandler) call `_resolve_symlink_target`, which now unconditionally
# reads `self.allowed_symlink_directory` -- an attribute those handlers
# never set -- causing "AttributeError: ... object has no attribute
# 'allowed_symlink_directory'" on basic requests like loading the lab
# theme CSS. Tracked upstream at tornadoweb/tornado#3724; unpin once
# fixed upstream.
RUN pip3 install --no-cache-dir \
      jupyterhub==4.* \
      jupyterlab==4.* \
      notebook==7.* \
      "tornado<6.5.9"
# Pin to a version compatible with the Node 16 shipped by Rocky 9's default
# nodejs module stream; newer configurable-http-proxy releases ship as ESM
# and fail to load ("Unknown file extension") on this Node version.
RUN npm install -g configurable-http-proxy@4.6.2

WORKDIR /srv/jupyterlab-slurm-src
COPY jupyterlab_slurm_dist/*.whl /tmp/
RUN pip3 install --no-cache-dir /tmp/*.whl && rm -f /tmp/*.whl

COPY jupyterhub_config.py /srv/jupyterhub/jupyterhub_config.py
COPY jupyter_server_config.py /etc/jupyter/jupyter_server_config.py
# Example admin-only site-hooks module referenced by jupyter_server_config.py's
# SlurmUI.site_hook_* settings (see docs/deployment.md for the real allow-list
# requirement); installed to site-packages so it's importable from any
# single-user server, matching how a real site would ship its own hooks package.
COPY site_hooks_example.py /usr/local/lib/python3.9/site-packages/site_hooks_example.py
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /srv/jupyterhub
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
