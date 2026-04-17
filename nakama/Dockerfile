FROM heroiclabs/nakama:3.22.0

COPY ./data/modules /nakama/data/modules
COPY ./local.yml /nakama/data/local.yml

CMD sh -c 'echo "ENV_VAR_CHECK=$DATABASE_ADDRESS" && sleep 20'
