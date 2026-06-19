# Database Schema Documentation

## Database Technology

* PostgreSQL
* Prisma ORM

## Main Entities

### User

Stores user information and authentication data.

Fields:

* id
* email
* password
* fullName
* role
* avatar
* isVerified
* isActive

Relationships:

* Assigned Tasks
* Created Tasks
* Project Memberships
* Team Memberships
* Comments
* Notifications
* AI Insights

---

### Project

Stores project information.

Fields:

* id
* name
* description
* status
* priority
* progress
* budget
* clientName

Relationships:

* Tasks
* Members
* Activities
* AI Insights
* Meetings
* Files

---

### Task

Stores project tasks.

Fields:

* id
* title
* description
* status
* priority
* dueDate
* estimatedHours
* actualHours

Relationships:

* Project
* Assignee
* Creator
* Comments
* Files
* Checklist
* Time Entries

---

### Team

Stores team information.

Fields:

* id
* name
* description

Relationships:

* Team Members
* Team Owner

---

### Comment

Stores task comments.

Fields:

* id
* content
* mentions

Relationships:

* Task
* Author

---

### File

Stores uploaded project and task files.

Fields:

* id
* name
* url
* mimeType
* size

Relationships:

* Project
* Task
* User

---

### TimeEntry

Tracks user working hours.

Fields:

* id
* description
* hours
* date

Relationships:

* User
* Task

---

### Notification

Stores system notifications.

Fields:

* id
* type
* title
* message
* isRead

Relationships:

* User

---

### AIInsight

Stores AI-generated recommendations and predictions.

Fields:

* id
* type
* title
* description
* score

Relationships:

* User
* Project

---

### Meeting

Stores project meeting information.

Fields:

* id
* title
* startTime
* endTime
* aiSummary

Relationships:

* Project
* Organizer
* Attendees

## Database Features

* JWT Authentication
* Role-Based Access Control (RBAC)
* Task Dependencies
* Team Collaboration
* AI Analytics
* Activity Tracking
* Audit Logging
* File Management
* Time Tracking
* Meeting Management
* Notification System
