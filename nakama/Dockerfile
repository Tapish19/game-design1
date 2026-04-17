FROM heroiclabs/nakama:3.22.0

COPY ./data/modules /nakama/data/modules
COPY ./local.yml /nakama/data/local.yml

ENTRYPOINT ["/bin/sh", "-ecx"]

CMD "
/nakama/nakama migrate up --database.address \"$DATABASE_ADDRESS\" &&
exec /nakama/nakama --config /nakama/data/local.yml --database.address \"$DATABASE_ADDRESS\"
"
