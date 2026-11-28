# Where check dafny runs: Dafny 4.11.0 on Ubuntu 22.04, both pinned, so every machine verifies with
# the same Dafny and the same Z3 whatever is installed on the computer it runs on.
FROM --platform=linux/amd64 ubuntu@sha256:b000e69a50ff940390233025e7a337fb8469b509e2334fa4d018ac30f3e18cdb
RUN apt-get update && apt-get install -y --no-install-recommends unzip libicu70 ca-certificates && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179 \
    https://github.com/dafny-lang/dafny/releases/download/v4.11.0/dafny-4.11.0-x64-ubuntu-22.04.zip /tmp/dafny.zip
RUN unzip -q /tmp/dafny.zip -d /opt && rm /tmp/dafny.zip
ENV PATH=/opt/dafny:$PATH
