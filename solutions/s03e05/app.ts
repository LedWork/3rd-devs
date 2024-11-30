import { Driver } from 'neo4j-driver';
import neo4j from 'neo4j-driver';
import fs from 'fs/promises';
import path from 'path';

interface User {
    id: string;
    username: string;
    access_level: string;
    is_active: string;
    lastlog: string;
}

interface Connection {
    user1_id: string;
    user2_id: string;
}

interface DataResponse<T> {
    reply: T[];
}

async function loadData() {
    const usersData = JSON.parse(
        await fs.readFile(path.join(__dirname, './users.json'), 'utf-8')
    ) as DataResponse<User>;
    
    const connectionsData = JSON.parse(
        await fs.readFile(path.join(__dirname, './connections.json'), 'utf-8')
    ) as DataResponse<Connection>;

    return {
        users: usersData.reply,
        connections: connectionsData.reply
    };
}

async function setupNeo4j(): Promise<Driver> {
    const driver = neo4j.driver(
        process.env.NEO4J_URI || 'neo4j://localhost:7687',
        neo4j.auth.basic(
            process.env.NEO4J_USER || 'neo4j',
            process.env.NEO4J_PASSWORD || 'neo4j'
        )
    );
    return driver;
}

async function createGraph(driver: Driver): Promise<void> {
    const session = driver.session();
    try {
        // Clear existing data
        await session.run('MATCH (n) DETACH DELETE n');

        const { users, connections } = await loadData();

        // Create nodes for users
        for (const user of users) {
            await session.run(
                `CREATE (:Person {id: $id, name: $name})`,
                { id: user.id, name: user.username }
            );
        }

        // Create relationships
        for (const conn of connections) {
            await session.run(`
                MATCH (p1:Person {id: $source})
                MATCH (p2:Person {id: $target})
                CREATE (p1)-[:KNOWS]->(p2)
            `, {
                source: conn.user1_id,
                target: conn.user2_id
            });
        }
    } finally {
        await session.close();
    }
}

async function findShortestPath(driver: Driver): Promise<string> {
    const session = driver.session();
    try {
        const result = await session.run(`
            MATCH path = shortestPath(
                (start:Person {name: 'Rafał'})-[:KNOWS*]->
                (end:Person {name: 'Barbara'})
            )
            RETURN [node IN nodes(path) | node.name] as names
        `);

        if (result.records.length === 0) {
            throw new Error('No path found');
        }

        return result.records[0].get('names').join(', ');
    } finally {
        await session.close();
    }
}

async function main() {
    const driver = await setupNeo4j();
    try {
        await createGraph(driver);
        const path = await findShortestPath(driver);
        
        // Send result to API
        console.log('Path:', path);
        const response = await fetch('https://centrala.ag3nts.org/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task: 'connections',
                apikey: process.env.AI_DEVS_API_KEY,
                answer: path
            })
        });

        const apiResponse = await response.json();
        console.log('API Response:', apiResponse);

    } finally {
        await driver.close();
    }
}

main().catch(console.error);
