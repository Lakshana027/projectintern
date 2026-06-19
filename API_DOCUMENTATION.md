# API Documentation

## Authentication

### Login

POST /auth/login

Request:

{
"email": "[user@example.com](mailto:user@example.com)",
"password": "password"
}

Response:

{
"token": "jwt-token"
}

## Register

POST /auth/register

Request:

{
"name": "User",
"email": "[user@example.com](mailto:user@example.com)",
"password": "password"
}

Response:

{
"message": "User registered successfully"
}

## Projects

### Get All Projects

GET /projects

### Create Project

POST /projects

Request:

{
"title": "Project Name",
"description": "Project Description"
}

### Update Project

PUT /projects/:id

### Delete Project

DELETE /projects/:id

## WebSocket Events

connect

disconnect

projectUpdate

notification
