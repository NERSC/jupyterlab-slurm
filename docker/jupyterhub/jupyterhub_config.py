import pwd

c = get_config()  # noqa: F821

# Real Linux-account login (created by entrypoint.sh) + real OS-level process
# spawning per user -- NOT a mocked/dummy identity -- so the extension's
# "server runs Slurm commands as the intended user" behavior can be tested
# end-to-end, closing the release-blocker gap that the root-only
# docker-exec wrapper scripts could not.
c.JupyterHub.authenticator_class = "pam"
c.PAMAuthenticator.open_sessions = False

c.JupyterHub.spawner_class = "jupyterhub.spawner.LocalProcessSpawner"
c.Spawner.default_url = "/lab"
c.Spawner.args = ["--SlurmTesting.enabled=True", "--SlurmTesting.allow_mutations=True"]

# Every account created in entrypoint.sh is allowed to log in; no extras.
c.Authenticator.allowed_users = {"hubadmin", "testuser1", "testuser2"}
c.Authenticator.admin_users = {"hubadmin"}

c.JupyterHub.bind_url = "http://0.0.0.0:8000"
c.JupyterHub.hub_bind_url = "http://0.0.0.0:8081"

# Keep things simple/local for this test rig -- not for production use.
c.JupyterHub.cookie_secret_file = "/srv/jupyterhub/jupyterhub_cookie_secret"
c.JupyterHub.db_url = "sqlite:////srv/jupyterhub/jupyterhub.sqlite"

# Sanity check at startup: fail fast if the demo users aren't present yet
# (entrypoint.sh should have created them before we get here).
for _name in c.Authenticator.allowed_users:
    pwd.getpwnam(_name)
