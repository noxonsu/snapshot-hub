# Snapshot hub

This is a hub for Snapshot network that stores the database and forwards new messages to peers. The hub hold a private keys to sign valid messages.

## Install

1. Install Node.js (14 version is required) and yarn
2. Clone the repository:

    ```sh
    git clone https://github.com/VitaliyShulik/snapshot-hub.git
    ```

3. Enter to the app directory `cd snapshot-hub` and install dependency:

    ```sh
    yarn
    ```

4. Copy [`.env.example`](https://github.com/VitaliyShulik/snapshot-hub/blob/master/.env.example), rename it to `.env` and set a value for these config vars:

    - `DATABASE_URL`: The database connection string. You will need to run your own MySQL database (or [restore backuped db](#backup-and-restore-data-base)) or use a Cloud service like [JawsDB](https://jawsdb.com).
    - `RELAYER_PK`: This is the private key of the hub. The hub counter-sign every accepted message with this key.
    - `PINNING_SERVICE`: This value must be "fleek" or "pinata". The hub support [Pinata](https://pinata.cloud/) or [Fleek](https://fleek.co) IPFS pinning services.
    - `FLEEK_API_KEY` and `FLEEK_API_SECRET` or `PINATA_API_KEY` and `PINATA_SECRET_API_KEY`: You need to setup API keys for the pinning service you've defined.

5. Create the database schema (optional with backup and restore db)

Run this query on the MySQL database to create the initial schema with the required tables:
<https://github.com/VitaliyShulik/snapshot-hub/blob/master/src/helpers/database/schema.sql>

## Backup and restore data base

1. Install MySQL (8 version is required). For ubuntu 18 I used this guide - <https://tecadmin.net/install-mysql-8-on-ubuntu-18-04/>

2. Create database and db user in MySQL environment on new server:

    ```sql
    CREATE DATABASE <db_name>;
    CREATE USER '<db_user_name>'@'localhost' IDENTIFIED BY ‘<db_password>‘;
    GRANT ALL PRIVILEGES ON * . * TO '<db_user_name>'@'localhost';
    ```

    - `db_password` must not contain special symbols, as it may result in an error, you can use some [generated password service](https://www.browserling.com/tools/mysql-password) and replace all special symbols to `$` if its contain.

    - In `.env` you should provide next string:
    `mysql://<db_user_name>:<db_password>@localhost:3306/<db_name>`

3. On old server make data base backup

    ```sh
    mysqldump <db_name> > <db_name>-$(date +%F).sql -u root -p
    ```

    - `$(date +%F)` is sh script that generate `date-of-backup` variable.

4. On your local computer get backup from old server:

    ```sh
    scp <old_server_user>@<old_server_ip>:/<path-to-dump-file>/<db_name>-<date-of-backup>.sql ~/<your-local-path>
    ```

5. On your local computer move backup on new server:

    ```sh
    scp ~/<your-local-path>/<db_name>-<date-of-backup>.sql <new_server_user>@<new_server_ip>:/<path-to-dump-file>
    ```

6. On new server make data base restore

    ```sh
    mysql -u <db_user_name> -p <db_name> < /<path-to-dump-file>/<db_name>-<date-of-backup>.sql
    ```

## Run

1. Install pm2

2. Use this command to run the hub:

    ```sh
    pm2 start "yarn start" --name snapshot-hub
    ```

3. Go on this page: <http://localhost:3000/api>  or make request with `curl http://localhost:3000/api` in server terminal and if everything is fine it should return details of the hub example:

    ```json
    {
      "name": "snapshot-hub",
      "network": "livenet",
      "version": "0.1.3",
      "tag": "alpha",
      "relayer": "0x8BBE4Ac64246d600BC2889ef5d83809D138F03DF"
    }
    ```

4. Set up nginx with your domain. You can follow this [guide](https://www.digitalocean.com/community/tutorials/how-to-install-nginx-on-ubuntu-20-04#step-5-%E2%80%93-setting-up-server-blocks-(recommended)).

## Usage

Once your hub is running online, the main hub can relay the messages received to your own hub. Please provide the URL of your Snapshot hub to an admin to make sure it's connected to the network.

### Load a space setting

To load a space settings in the database you can go on this endpoint <http://localhost:3000/api/spaces/yam.eth/poke> (change yam.eth with the space you want to activate).


## for devops
1. login to docckerator machine
2. cd snapshot-hub
3. pm2 stop snapshothub 
4. git pull
5. pm2 start snapshothub
