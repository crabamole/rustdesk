# The release's installers in a registry image, for sites that pull from a mirror instead of GitHub.
# busybox so `docker run ... cp` works; the files are not meant to run in the container.
FROM busybox:1.37
ARG VERSION
LABEL org.opencontainers.image.title="cRustDesk installers" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/crabamole/rustdesk" \
      org.opencontainers.image.documentation="https://github.com/crabamole/rustdesk/blob/${VERSION}/docs/crustdesk-install.md"
COPY dist/ /installers/
CMD ["ls", "-l", "/installers"]
